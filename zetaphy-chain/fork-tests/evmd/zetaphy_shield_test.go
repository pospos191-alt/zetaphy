//go:build test

package evmd

// The "zetaphy-shield" upgrade (zetaphy_shield.go; internal review 2026-11-10,
// Z-01..Z-03): the account guard covers every message and every EIP-7702 code
// delegation, a tx with more messages than the guard and the threat gate read
// is refused, and the invariant firewall runs after every message that can
// execute EVM code. Below the shield height everything answers exactly as the
// binary without it (same results, errors and gas).

import (
	"crypto/ecdsa"
	"fmt"
	"math/big"
	"reflect"
	"testing"
	"time"

	wasmtypes "github.com/CosmWasm/wasmd/x/wasm/types"
	cmtproto "github.com/cometbft/cometbft/proto/tendermint/types"
	"github.com/ethereum/go-ethereum/common"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/holiman/uint256"
	"github.com/stretchr/testify/require"

	transfertypes "github.com/cosmos/ibc-go/v11/modules/apps/transfer/types"
	clienttypes "github.com/cosmos/ibc-go/v11/modules/core/02-client/types"
	channeltypes "github.com/cosmos/ibc-go/v11/modules/core/04-channel/types"
	channeltypesv2 "github.com/cosmos/ibc-go/v11/modules/core/04-channel/v2/types"
	porttypes "github.com/cosmos/ibc-go/v11/modules/core/05-port/types"
	ibcapi "github.com/cosmos/ibc-go/v11/modules/core/api"
	ibcexported "github.com/cosmos/ibc-go/v11/modules/core/exported"

	sdkmath "cosmossdk.io/math"

	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	storetypes "github.com/cosmos/cosmos-sdk/store/v2/types"
	sdk "github.com/cosmos/cosmos-sdk/types"
	errortypes "github.com/cosmos/cosmos-sdk/types/errors"
	"github.com/cosmos/cosmos-sdk/x/authz"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	upgradetypes "github.com/cosmos/cosmos-sdk/x/upgrade/types"

	erc20types "github.com/cosmos/evm/x/erc20/types"
	evmtypes "github.com/cosmos/evm/x/vm/types"
)

// shSend: a one-unit bank send between two accounts.
func shSend(from, to sdk.AccAddress) *banktypes.MsgSend {
	return &banktypes.MsgSend{FromAddress: from.String(), ToAddress: to.String(), Amount: sdk.NewCoins(sdk.NewInt64Coin(evmtypes.GetEVMCoinDenom(), 1))}
}

// shOldExpand: how the guard and the threat gate walked a tx's messages before
// the shield (the first 64 entries, authz MsgExec expanded breadth first).
func shOldExpand(tx sdk.Tx) []sdk.Msg {
	var out []sdk.Msg
	msgs := append([]sdk.Msg{}, tx.GetMsgs()...)
	for i := 0; i < len(msgs) && i < 64; i++ {
		if m, ok := msgs[i].(*authz.MsgExec); ok {
			if inner, err := m.GetMessages(); err == nil {
				msgs = append(msgs, inner...)
			}
		}
		out = append(out, msgs[i])
	}
	return out
}

func shExec(grantee sdk.AccAddress, msgs ...sdk.Msg) *authz.MsgExec {
	m := authz.NewMsgExec(grantee, msgs)
	return &m
}

// shEthTx: a signed Ethereum tx as the ante handler sees it; auths makes it an
// EIP-7702 SetCode tx.
func shEthTx(t *testing.T, app *EVMD, key *ecdsa.PrivateKey, nonce uint64, to common.Address, auths ...ethtypes.SetCodeAuthorization) sdk.Tx {
	chainID := evmtypes.GetEthChainConfig().ChainID
	signer := ethtypes.LatestSignerForChainID(chainID)
	var inner ethtypes.TxData = &ethtypes.DynamicFeeTx{ChainID: chainID, Nonce: nonce, To: &to, Gas: 100000,
		GasFeeCap: big.NewInt(10_000_000_000), GasTipCap: big.NewInt(1)}
	if len(auths) > 0 {
		inner = &ethtypes.SetCodeTx{ChainID: uint256.MustFromBig(chainID), Nonce: nonce, To: to, Gas: 100000,
			GasFeeCap: uint256.NewInt(10_000_000_000), GasTipCap: uint256.NewInt(1), Value: uint256.NewInt(0), AuthList: auths}
	}
	signed, err := ethtypes.SignTx(ethtypes.NewTx(inner), signer, key)
	require.NoError(t, err)
	m := &evmtypes.MsgEthereumTx{}
	require.NoError(t, m.FromSignedEthereumTx(signed, signer))
	out, err := m.BuildTx(app.GetTxConfig().NewTxBuilder(), evmtypes.GetEVMCoinDenom())
	require.NoError(t, err)
	return out
}

// shAuth: an EIP-7702 authorization by key delegating its account's code to target.
func shAuth(t *testing.T, key *ecdsa.PrivateKey, chainID *big.Int, nonce uint64, target common.Address) ethtypes.SetCodeAuthorization {
	a, err := ethtypes.SignSetCode(key, ethtypes.SetCodeAuthorization{ChainID: *uint256.MustFromBig(chainID), Address: target, Nonce: nonce})
	require.NoError(t, err)
	return a
}

// shGas: the gas f consumes on a fresh meter, and its error.
func shGas(ctx sdk.Context, f func(sdk.Context) error) (uint64, error) {
	c := ctx.WithGasMeter(storetypes.NewGasMeter(50_000_000))
	err := f(c)
	return c.GasMeter().GasConsumed(), err
}

func TestShieldUpgradeHandler(t *testing.T) {
	app, ctx := futApp(t)
	require.True(t, zetaphyEarlyUpgrades[ZetaphyShieldUpgradeName], "zetaphy-shield adds no store: it may run early")
	require.Contains(t, zetaphyUpgradeNames, ZetaphyShieldUpgradeName)
	require.NoError(t, app.UpgradeKeeper.ScheduleUpgrade(upgAt(ctx, 40), upgradetypes.Plan{Name: ZetaphyShieldUpgradeName, Height: 50}))
	for h := int64(41); h < 50; h++ {
		_, err := app.ModuleManager.PreBlock(upgAt(ctx, h))
		require.NoError(t, err, "block %d: the new binary goes on before the height", h)
		require.False(t, app.shieldActive(upgAt(ctx, h)))
	}
	_, err := app.ModuleManager.PreBlock(upgAt(ctx, 50))
	require.NoError(t, err)
	require.Equal(t, int64(51), app.shieldHeight(ctx))
	require.False(t, app.shieldActive(upgAt(ctx, 50)))
	require.True(t, app.shieldActive(upgAt(ctx, 51)))
	// genesis may carry it (8 bytes), nothing else under 0x50
	_, err = pqParseGenesis([]byte(`[{"key":"50","value":"0000000000000001"}]`))
	require.NoError(t, err)
	_, err = pqParseGenesis([]byte(`[{"key":"50","value":"01"}]`))
	require.Error(t, err)
	_, err = pqParseGenesis([]byte(`[{"key":"52","value":"01"}]`))
	require.Error(t, err)
}

// Before the shield height: the same answers, errors and gas as the binary without it.
func TestShieldGuardOffBeforeHeight(t *testing.T) {
	app, ctx := futApp(t)
	user, other := secPQAccount(t, app, ctx), secPQAccount(t, app, ctx)
	scam := sdk.AccAddress(common.HexToAddress("0x00000000000000000000000000000000005ca400").Bytes())
	ctx.KVStore(app.GetKey(pqStoreKey)).Set(append([]byte{immuneScorePfx}, scam...), append([]byte{0x1f, 0x40}, make([]byte, 10)...))
	futSet(t, app, ctx, "immune", immuneParams{Enabled: true})
	_, err := futCall(app, ctx, user, GuardPrecompileAddress, GuardABI, "protect", uint8(guardModeReject), uint64(0))
	require.NoError(t, err)

	// the message walk is the old one, entry for entry
	var long []sdk.Msg
	for i := 0; i < 70; i++ {
		long = append(long, shSend(other, user))
	}
	for _, tx := range []sdk.Tx{
		futTx(t, app, long[:3]...),
		futTx(t, app, long...),
		futTx(t, app, append([]sdk.Msg{shExec(other, long[:40]...)}, long[:30]...)...),
		futTx(t, app, shExec(other, shExec(other, long[:66]...)), shSend(user, scam)),
	} {
		got, err := zetaphyTxMsgs(tx, false)
		require.NoError(t, err)
		require.Equal(t, shOldExpand(tx), got)
	}

	// the guard: the 65th message is not read, as before
	tail := futTx(t, app, append(append([]sdk.Msg{}, long[:64]...), shSend(user, scam))...)
	require.NoError(t, app.guardTx(ctx, tail))
	require.ErrorIs(t, app.guardTx(ctx, futTx(t, app, append(append([]sdk.Msg{}, long[:63]...), shSend(user, scam))...)), ErrGuard)

	// an EIP-7702 delegation by a protected account passes, as before
	ownerKey, _ := crypto.GenerateKey()
	owner := crypto.PubkeyToAddress(ownerKey.PublicKey)
	_, err = app.guardProtect(ctx, owner, guardModeReject, 0)
	require.NoError(t, err)
	senderKey, _ := crypto.GenerateKey()
	chainID := evmtypes.GetEthChainConfig().ChainID
	deleg := shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, common.HexToAddress("0x00000000000000000000000000000000000c0de0")))
	require.NoError(t, app.guardTx(ctx, deleg))

	// the firewall extras do nothing (the firewall is on and a protocol breaks)
	e := fwSetup(t)
	e.on(t)
	require.NoError(t, e.app.BankKeeper.SendCoins(e.ctx, sdk.AccAddress(e.vault.Bytes()), e.user, sdk.NewCoins(sdk.NewCoin(evmtypes.GetEVMCoinDenom(), sdkmath.NewInt(1)))))
	require.NoError(t, e.app.shieldFirewall(e.ctx))
	fctx := e.ctx.WithExecMode(sdk.ExecModeFinalize)
	_, err = e.app.shieldPostHandler(fctx, futTx(t, e.app, &erc20types.MsgConvertERC20{}), false, true)
	require.NoError(t, err)
	before := shStoreDigest(e)
	err = newIBCHoldMiddleware(e.app, shBreakingApp{t: t, e: e}).OnAcknowledgementPacket(e.ctx, "ics20-1", channeltypes.Packet{}, nil, nil)
	require.NoError(t, err)
	require.NotEqual(t, before, shStoreDigest(e), "the inner app ran")

	// same gas whether the shield height is unset or still ahead (0x50 is read without gas)
	measure := func() []uint64 {
		var out []uint64
		for _, f := range []func(sdk.Context) error{
			func(c sdk.Context) error { return app.guardTx(c, tail) },
			func(c sdk.Context) error { return app.guardTx(c, deleg) },
			func(c sdk.Context) error { return app.threatGateTx(c, tail) },
			func(c sdk.Context) error { _, err := app.shieldPostHandler(c, tail, false, true); return err },
			app.shieldFirewall,
		} {
			g, err := shGas(ctx, f)
			require.NoError(t, err)
			out = append(out, g)
		}
		return out
	}
	unset := measure()
	app.setShieldHeight(ctx, 1000)
	require.False(t, app.shieldActive(ctx))
	require.Equal(t, unset, measure(), "gas below the height")
	require.NoError(t, app.guardTx(ctx, tail))
	require.NoError(t, app.guardTx(ctx, deleg))
}

// Z-01: no EIP-7702 code delegation for an account the guard protects.
func TestShieldGuardCodeDelegation(t *testing.T) {
	app, ctx := futApp(t)
	app.setShieldHeight(ctx, 1)
	require.True(t, app.shieldActive(ctx))
	chainID := evmtypes.GetEthChainConfig().ChainID
	code := common.HexToAddress("0x00000000000000000000000000000000000c0de0")
	ownerKey, _ := crypto.GenerateKey()
	owner := crypto.PubkeyToAddress(ownerKey.PublicKey)
	pqFund(t, app, ctx, owner.Bytes(), secOne())
	senderKey, _ := crypto.GenerateKey()
	sender := crypto.PubkeyToAddress(senderKey.PublicKey)
	pqFund(t, app, ctx, sender.Bytes(), secOne())

	// not protected: a delegation is an ordinary tx
	require.NoError(t, app.guardTx(ctx, shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, code))))

	_, err := app.guardProtect(ctx, owner, guardModeReject, 0)
	require.NoError(t, err)
	for name, tx := range map[string]sdk.Tx{
		"in another account's tx":      shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, code)),
		"in its own tx, to itself":     shEthTx(t, app, ownerKey, 0, owner, shAuth(t, ownerKey, chainID, 1, code)),
		"valid on every chain (id 0)":  shEthTx(t, app, senderKey, 0, sender, shAuth(t, ownerKey, big.NewInt(0), 0, code)),
		"after another account's auth": shEthTx(t, app, senderKey, 0, sender, shAuth(t, senderKey, chainID, 1, code), shAuth(t, ownerKey, chainID, 0, code)),
		"clearing to the zero address": shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, common.Address{})),
	} {
		err := app.guardTx(ctx, tx)
		require.ErrorIs(t, err, ErrGuard, name)
		require.ErrorContains(t, err, owner.Hex(), name)
	}
	// the full ante handler (CheckTx) refuses it too
	cp := ctx.ConsensusParams()
	cp.Block = &cmtproto.BlockParams{MaxGas: 30_000_000, MaxBytes: 2_000_000}
	actx := ctx.WithConsensusParams(cp).WithBlockGasMeter(storetypes.NewGasMeter(30_000_000)).WithExecMode(sdk.ExecModeCheck)
	cc, _ := actx.CacheContext()
	_, err = app.AnteHandler()(cc, shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, code)), false)
	require.ErrorIs(t, err, ErrGuard, "through the ante handler")
	// an unprotected authority in the same position still passes
	otherKey, _ := crypto.GenerateKey()
	require.NoError(t, app.guardTx(ctx, shEthTx(t, app, senderKey, 0, owner, shAuth(t, otherKey, chainID, 0, code))))

	// the anomaly hold counts as protection; opting out waits its timeout
	holderKey, _ := crypto.GenerateKey()
	holder := crypto.PubkeyToAddress(holderKey.PublicKey)
	require.NoError(t, app.holdOptIn(ctx, holder, sender, 3600, big.NewInt(10), 30000))
	holdTx := shEthTx(t, app, senderKey, 0, sender, shAuth(t, holderKey, chainID, 0, code))
	require.ErrorIs(t, app.guardTx(ctx, holdTx), ErrGuard)
	c := app.holdCfgOf(ctx, holder)
	c.optOutAt = ctx.BlockTime().Unix() + 3600
	app.setHoldCfg(ctx, holder, c)
	require.ErrorIs(t, app.guardTx(ctx.WithBlockTime(ctx.BlockTime().Add(30*time.Minute)), holdTx), ErrGuard, "opt-out pending")
	require.NoError(t, app.guardTx(ctx.WithBlockTime(ctx.BlockTime().Add(61*time.Minute)), holdTx), "opted out")

	// protection being switched off: refused until the switch-off applies
	at, err := app.guardProtect(ctx, owner, guardModeOff, 0)
	require.NoError(t, err)
	tx := shEthTx(t, app, senderKey, 0, owner, shAuth(t, ownerKey, chainID, 0, code))
	require.ErrorIs(t, app.guardTx(ctx.WithBlockTime(time.Unix(at-1, 0)), tx), ErrGuard)
	require.NoError(t, app.guardTx(ctx.WithBlockTime(time.Unix(at, 0)), tx))
}

// Z-02: every message is read, or the tx is refused.
func TestShieldGuardMessageLimit(t *testing.T) {
	app, ctx := futApp(t)
	app.setShieldHeight(ctx, 1)
	user, other := secPQAccount(t, app, ctx), secPQAccount(t, app, ctx)
	scamAddr := common.HexToAddress("0x00000000000000000000000000000000005ca400")
	scam := sdk.AccAddress(scamAddr.Bytes())
	ctx.KVStore(app.GetKey(pqStoreKey)).Set(append([]byte{immuneScorePfx}, scam...), append([]byte{0x1f, 0x40}, make([]byte, 10)...))
	futSet(t, app, ctx, "immune", immuneParams{Enabled: true})
	_, err := futCall(app, ctx, user, GuardPrecompileAddress, GuardABI, "protect", uint8(guardModeReject), uint64(0))
	require.NoError(t, err)
	var pad []sdk.Msg
	for i := 0; i < 70; i++ {
		pad = append(pad, shSend(other, user))
	}
	with := func(n int, last sdk.Msg) sdk.Tx {
		return futTx(t, app, append(append([]sdk.Msg{}, pad[:n]...), last)...)
	}

	require.ErrorIs(t, app.guardTx(ctx, with(63, shSend(user, scam))), ErrGuard, "64 messages: all read")
	require.NoError(t, app.guardTx(ctx, with(63, shSend(other, scam))))
	err = app.guardTx(ctx, with(64, shSend(user, scam)))
	require.ErrorIs(t, err, errortypes.ErrInvalidRequest, "65 messages: refused, not read in part")
	require.ErrorContains(t, err, "at most 64 messages")
	require.ErrorIs(t, app.guardTx(ctx, with(64, shSend(other, other))), errortypes.ErrInvalidRequest, "whatever the messages are")
	// authz inner messages count, at any depth
	require.ErrorIs(t, app.guardTx(ctx, futTx(t, app, shExec(other, pad[:64]...))), errortypes.ErrInvalidRequest)
	require.ErrorIs(t, app.guardTx(ctx, futTx(t, app, shExec(other, shExec(other, pad[:40]...)), shExec(other, pad[:30]...))), errortypes.ErrInvalidRequest)
	require.NoError(t, app.guardTx(ctx, futTx(t, app, shExec(other, pad[:63]...))), "MsgExec + 63 inner = 64")
	require.ErrorIs(t, app.guardTx(ctx, futTx(t, app, shExec(other, append(append([]sdk.Msg{}, pad[:62]...), shSend(user, scam))...))), ErrGuard,
		"an inner message at the end is read")

	// the threat gate the same way (its own check, also with the guard idle)
	reg := secDeploy(t, app, ctx, user, secRegistryRuntime)
	flagged := common.HexToAddress("0x00000000000000000000000000000000000bad00")
	secFlag(app, ctx, reg, flagged, 6)
	_, err = app.setThreatGate(ctx, &MsgSetThreatGate{Authority: secGovAddr(), Registry: reg.Hex(), Enabled: 1})
	require.NoError(t, err)
	call := &MsgEVMCall{Sender: other.String(), To: flagged.Hex(), GasLimit: 50000}
	require.ErrorIs(t, app.threatGateTx(ctx, with(63, call)), ErrThreatFlagged)
	require.ErrorIs(t, app.threatGateTx(ctx, with(64, call)), errortypes.ErrInvalidRequest)
	app.setShieldHeight(ctx, 1000)
	require.NoError(t, app.threatGateTx(ctx, with(64, call)), "before the height: the 65th is not read")
	require.NoError(t, app.guardTx(ctx, with(64, shSend(user, scam))))
}

// ---- Z-03: the firewall after every EVM-executing message

func shStoreDigest(e *fwEnv) string {
	return e.vaultBalance().String() + "/" + e.app.BankKeeper.GetBalance(e.ctx, e.user, evmtypes.GetEVMCoinDenom()).Amount.String()
}

// shBreakingApp: an IBC application whose packet handling breaks the vault's
// solvency invariant (stands for EVM code run by a conversion or callback).
type shBreakingApp struct {
	porttypes.IBCModule
	t      *testing.T
	e      *fwEnv
	benign bool
}

func (a shBreakingApp) move(ctx sdk.Context) {
	amt := sdkmath.NewInt(1)
	if a.benign {
		require.NoError(a.t, a.e.app.BankKeeper.SendCoins(ctx, a.e.user, a.e.pgov, sdk.NewCoins(sdk.NewCoin(evmtypes.GetEVMCoinDenom(), amt))))
		return
	}
	require.NoError(a.t, a.e.app.BankKeeper.SendCoins(ctx, sdk.AccAddress(a.e.vault.Bytes()), a.e.user, sdk.NewCoins(sdk.NewCoin(evmtypes.GetEVMCoinDenom(), amt))))
}

func (a shBreakingApp) OnRecvPacket(ctx sdk.Context, _ string, _ channeltypes.Packet, _ sdk.AccAddress) ibcexported.Acknowledgement {
	a.move(ctx)
	return channeltypes.NewResultAcknowledgement([]byte{1})
}

func (a shBreakingApp) OnAcknowledgementPacket(ctx sdk.Context, _ string, _ channeltypes.Packet, _ []byte, _ sdk.AccAddress) error {
	a.move(ctx)
	return nil
}

func (a shBreakingApp) OnTimeoutPacket(ctx sdk.Context, _ string, _ channeltypes.Packet, _ sdk.AccAddress) error {
	a.move(ctx)
	return nil
}

type shBreakingAppV2 struct {
	ibcapi.IBCModule
	a shBreakingApp
}

func (b shBreakingAppV2) OnRecvPacket(ctx sdk.Context, _, _ string, _ uint64, _ channeltypesv2.Payload, _ sdk.AccAddress) channeltypesv2.RecvPacketResult {
	b.a.move(ctx)
	return channeltypesv2.RecvPacketResult{Status: channeltypesv2.PacketStatus_Success, Acknowledgement: []byte{1}}
}

func (b shBreakingAppV2) OnAcknowledgementPacket(ctx sdk.Context, _, _ string, _ uint64, _ []byte, _ channeltypesv2.Payload, _ sdk.AccAddress) error {
	b.a.move(ctx)
	return nil
}

func (b shBreakingAppV2) OnTimeoutPacket(ctx sdk.Context, _, _ string, _ uint64, _ channeltypesv2.Payload, _ sdk.AccAddress) error {
	b.a.move(ctx)
	return nil
}

// IBC packets (v1 and v2): a packet that breaks an invariant gets an error
// acknowledgement (receive) or fails (acknowledgement, timeout).
func TestShieldFirewallIBCPackets(t *testing.T) {
	e := fwSetup(t)
	e.on(t)
	e.app.setShieldHeight(e.ctx, 1)
	held := e.vaultBalance()
	v1 := newIBCHoldMiddleware(e.app, shBreakingApp{t: t, e: e})
	v2 := &ibcHoldV2{app: shBreakingAppV2{a: shBreakingApp{t: t, e: e}}, z: e.app}
	run := func(f func(sdk.Context) error) error { // as IBC core: the message's state is kept only on success
		c, write := e.ctx.CacheContext()
		err := f(c)
		if err == nil {
			write()
		}
		return err
	}
	var ack ibcexported.Acknowledgement
	_ = run(func(c sdk.Context) error {
		ack = v1.OnRecvPacket(c, "ics20-1", channeltypes.Packet{}, nil)
		if !ack.Success() {
			return fmt.Errorf("error ack") // IBC core drops the state of a failed receive
		}
		return nil
	})
	require.False(t, ack.Success(), "receive: error acknowledgement")
	require.Contains(t, string(ack.Acknowledgement()), "ABCI code: 40", "the firewall's code")
	require.ErrorIs(t, run(func(c sdk.Context) error {
		return v1.OnAcknowledgementPacket(c, "ics20-1", channeltypes.Packet{}, nil, nil)
	}), ErrInvariantFirewall)
	require.ErrorIs(t, run(func(c sdk.Context) error { return v1.OnTimeoutPacket(c, "ics20-1", channeltypes.Packet{}, nil) }), ErrInvariantFirewall)
	var res channeltypesv2.RecvPacketResult
	_ = run(func(c sdk.Context) error {
		res = v2.OnRecvPacket(c, "a", "b", 1, channeltypesv2.Payload{}, nil)
		return fmt.Errorf("discard")
	})
	require.Equal(t, channeltypesv2.PacketStatus_Failure, res.Status, "v2 receive: failure")
	require.ErrorIs(t, run(func(c sdk.Context) error {
		return v2.OnAcknowledgementPacket(c, "a", "b", 1, nil, channeltypesv2.Payload{}, nil)
	}), ErrInvariantFirewall)
	require.ErrorIs(t, run(func(c sdk.Context) error { return v2.OnTimeoutPacket(c, "a", "b", 1, channeltypesv2.Payload{}, nil) }), ErrInvariantFirewall)
	require.True(t, held.Equal(e.vaultBalance()), "nothing left the vault")

	// a packet that keeps every invariant goes through
	ok := newIBCHoldMiddleware(e.app, shBreakingApp{t: t, e: e, benign: true})
	require.True(t, ok.OnRecvPacket(e.ctx, "ics20-1", channeltypes.Packet{}, nil).Success())
	require.NoError(t, ok.OnAcknowledgementPacket(e.ctx, "ics20-1", channeltypes.Packet{}, nil, nil))

	// below the height the same packets pass (the old behaviour)
	e.app.setShieldHeight(e.ctx, 1000)
	require.True(t, v1.OnRecvPacket(e.ctx, "ics20-1", channeltypes.Packet{}, nil).Success())
	require.NoError(t, v1.OnAcknowledgementPacket(e.ctx, "ics20-1", channeltypes.Packet{}, nil, nil))
	require.Equal(t, channeltypesv2.PacketStatus_Success, v2.OnRecvPacket(e.ctx, "a", "b", 1, channeltypesv2.Payload{}, nil).Status)
}

// IBC callbacks into a contract, through cosmos/evm's real callbacks keeper:
// a callback that breaks an invariant is discarded, the packet goes on.
func TestShieldFirewallIBCCallbacks(t *testing.T) {
	e := fwSetup(t)
	e.on(t)
	ctorArgs := append(common.LeftPadBytes(e.vault.Bytes(), 32), common.LeftPadBytes(fwTenth().Bytes(), 32)...)
	out, err := e.app.evmCall(e.ctx, &MsgEVMCall{Sender: e.user.String(), Data: append(fwBin(t, "CallbackVaultBreaker"), ctorArgs...), GasLimit: 3_000_000})
	require.NoError(t, err)
	cb := common.HexToAddress(out.(*MsgEVMCallResponse).Created)
	sender := sdk.AccAddress(cb.Bytes()).String()
	data := transfertypes.FungibleTokenPacketData{Denom: evmtypes.GetEVMCoinDenom(), Amount: "1", Sender: sender, Receiver: sender,
		Memo: fmt.Sprintf(`{"src_callback":{"address":"%s","gas_limit":"1000000"}}`, cb.Hex())}
	packet := channeltypes.NewPacket(data.GetBytes(), 1, "transfer", "channel-0", "transfer", "channel-1", clienttypes.ZeroHeight(), uint64(time.Now().Add(time.Hour).UnixNano()))
	ack := channeltypes.NewResultAcknowledgement([]byte{1}).Acknowledgement()
	k := shieldCallbacks{ContractKeeper: e.app.CallbackKeeper, app: e.app}
	// as ibc-go's callbacks middleware: the callback's state is kept only if it returns no error
	process := func(ctx sdk.Context, f func(sdk.Context) error) error {
		c, write := ctx.CacheContext()
		err := f(c)
		if err == nil {
			write()
		}
		return err
	}
	onAck := func(c sdk.Context) error {
		return k.IBCOnAcknowledgementPacketCallback(c, packet, ack, nil, cb.Hex(), sender, transfertypes.V1)
	}
	onTimeout := func(c sdk.Context) error {
		return k.IBCOnTimeoutPacketCallback(c, packet, nil, cb.Hex(), sender, transfertypes.V1)
	}
	held := e.vaultBalance()

	// before the shield height: the callback is not checked and the vault is drained
	for _, f := range []func(sdk.Context) error{onAck, onTimeout} {
		c, _ := e.ctx.CacheContext()
		require.NoError(t, process(c, f))
		require.True(t, e.app.BankKeeper.GetBalance(c, sdk.AccAddress(e.vault.Bytes()), evmtypes.GetEVMCoinDenom()).Amount.LT(held), "old behaviour: drained")
	}

	// from it: refused, nothing leaves the vault, and the next check point sees it healthy
	e.app.setShieldHeight(e.ctx, 1)
	require.ErrorIs(t, process(e.ctx, onAck), ErrInvariantFirewall)
	require.ErrorIs(t, process(e.ctx, onTimeout), ErrInvariantFirewall)
	require.True(t, held.Equal(e.vaultBalance()))
	e.app.firewallBeginBlock(e.ctx)
	base, err := firewallDecodeSet(e.app.secRaw(e.ctx).Get(firewallBaseKey))
	require.NoError(t, err)
	require.Empty(t, base, "nothing recorded as broken")
}

// Transactions with messages that can run EVM code (ICS-20, ERC-20, CosmWasm,
// also inside authz) are checked after their messages ran; others are not.
func TestShieldFirewallPostHandler(t *testing.T) {
	e := fwSetup(t)
	e.on(t)
	e.app.setShieldHeight(e.ctx, 1)
	// the app's post handler is this one
	ph := reflect.ValueOf(e.app.BaseApp).Elem().FieldByName("postHandler")
	require.False(t, ph.IsNil())
	require.Equal(t, reflect.ValueOf(e.app.shieldPostHandler).Pointer(), ph.Pointer())

	broken, _ := e.ctx.CacheContext()
	require.NoError(t, e.app.BankKeeper.SendCoins(broken, sdk.AccAddress(e.vault.Bytes()), e.user, sdk.NewCoins(sdk.NewCoin(evmtypes.GetEVMCoinDenom(), sdkmath.NewInt(1)))))
	fin := broken.WithExecMode(sdk.ExecModeFinalize)
	post := func(c sdk.Context, success bool, msgs ...sdk.Msg) error {
		_, err := e.app.shieldPostHandler(c, futTx(t, e.app, msgs...), false, success)
		return err
	}
	for name, m := range map[string]sdk.Msg{
		"ERC-20 conversion": &erc20types.MsgConvertERC20{},
		"coin conversion":   &erc20types.MsgConvertCoin{},
		"ICS-20 transfer":   &transfertypes.MsgTransfer{},
		"CosmWasm":          &wasmtypes.MsgExecuteContract{},
		"inside authz":      shExec(e.user, shExec(e.user, &transfertypes.MsgTransfer{})),
	} {
		require.ErrorIs(t, post(fin, true, shSend(e.user, e.pgov), m), ErrInvariantFirewall, name)
		require.ErrorIs(t, post(broken.WithExecMode(sdk.ExecModeSimulate), true, m), ErrInvariantFirewall, name+" (simulate)")
		require.NoError(t, post(broken.WithExecMode(sdk.ExecModeCheck), true, m), name+": CheckTx runs no messages")
		require.NoError(t, post(fin, false, m), name+": a failed tx is discarded anyway")
	}
	require.NoError(t, post(fin, true, shSend(e.user, e.pgov)), "a message that runs no EVM code")
	g, err := shGas(fin, func(c sdk.Context) error { return post(c, true, &erc20types.MsgConvertCoin{}) })
	require.ErrorIs(t, err, ErrInvariantFirewall)
	require.Zero(t, g, "the check charges no gas")
	healthy := e.ctx.WithExecMode(sdk.ExecModeFinalize)
	require.NoError(t, post(healthy, true, &erc20types.MsgConvertERC20{}))
}

// Internal review 2026-11-12, Z-44 and Z-46: from the shield height the circuit
// authority cannot trip the chain's own or IBC core client/channel messages,
// its trips lapse unless governance confirms them, it cannot trip a type again
// right after a reset or a lapse, and it must sign the tx itself.
func TestShieldGuardCircuit(t *testing.T) {
	app, ctx := cgApp(t)
	gov := secGovAddr()
	k1, k2, k3 := secp256k1.GenPrivKey().PubKey(), secp256k1.GenPrivKey().PubKey(), secp256k1.GenPrivKey().PubKey()
	ms := cgAccount(t, app, ctx, multisig.NewLegacyAminoPubKey(2, []cryptotypes.PubKey{k1, k2, k3}))
	grantee := cgAccount(t, app, ctx, secp256k1.GenPrivKey().PubKey())
	require.NoError(t, cgSet(app, ctx, gov, "circuit-authority", map[string]string{"address": ms.String()}))
	send, lock := "/cosmos.bank.v1beta1.MsgSend", "/zetaphy.pq.v1.MsgQuantumLock"
	trip := func(u string) map[string]any { return map[string]any{"msgs": []string{u}} }
	allowed := func(c sdk.Context, u string) bool { ok, _ := zetaphyCircuit{app}.IsAllowed(c, u); return ok }
	signed := ctx.WithValue(shieldSignersKey{}, [][]byte{ms})
	at := func(h int64) sdk.Context { return signed.WithBlockHeight(h) }

	// before the height: the old rules (the authority trips a chain message; no signer check)
	app.setShieldHeight(ctx, 1000)
	require.NoError(t, cgSet(app, ctx, ms.String(), "circuit-trip", trip(lock)))
	require.False(t, allowed(ctx, lock))

	app.setShieldHeight(ctx, 1)
	require.True(t, allowed(ctx, lock), "a trip of a message that is now protected stops applying")
	for _, u := range []string{lock, "/zetaphy.pq.v1.MsgQDayReveal", "/zetaphy.pq.v1.MsgIBCHoldCancel", "/zetaphy.pq.v1.MsgSetQDay",
		"/ibc.core.client.v1.MsgUpdateClient", "/ibc.core.channel.v1.MsgRecvPacket", "/ibc.core.channel.v1.MsgTimeout", "/ibc.core.channel.v2.MsgRecvPacket"} {
		require.ErrorIs(t, cgSet(app, signed, ms.String(), "circuit-trip", trip(u)), ErrCircuit, "%s: authority", u)
		require.ErrorIs(t, cgSet(app, ctx, gov, "circuit-trip", trip(u)), ErrCircuit, "%s: governance", u)
	}

	// the authority signs itself: not through authz (the grantee signs that tx) or a contract
	err := cgSet(app, ctx, ms.String(), "circuit-trip", trip(send))
	require.ErrorIs(t, err, ErrCircuit)
	require.ErrorContains(t, err, "must sign the transaction itself")
	exec := authz.NewMsgExec(grantee, []sdk.Msg{&MsgSetFuture{Authority: ms.String(), Kind: "circuit-trip"}})
	require.ErrorIs(t, cgSet(app, app.shieldNoteSigners(ctx, cgTx(t, app, &exec)), ms.String(), "circuit-trip", trip(send)), ErrCircuit, "through authz")
	direct := app.shieldNoteSigners(ctx, cgTx(t, app, &MsgSetFuture{Authority: ms.String(), Kind: "circuit-trip"}))
	require.NoError(t, cgSet(app, direct, ms.String(), "circuit-trip", trip(send)), "signed by the multisig itself")
	h0 := ctx.BlockHeight()

	// the authority's trip lapses; a second trip does not extend it; it cannot trip again at once
	require.False(t, allowed(at(h0+circuitAuthorityTripBlocks-1), send))
	require.NoError(t, cgSet(app, at(h0+50), ms.String(), "circuit-trip", trip(send)))
	require.True(t, allowed(at(h0+circuitAuthorityTripBlocks), send), "lapsed")
	require.ErrorIs(t, cgSet(app, at(h0+circuitAuthorityTripBlocks), ms.String(), "circuit-trip", trip(send)), ErrCircuit, "not again right after")
	require.NoError(t, cgSet(app, at(h0+2*circuitAuthorityTripBlocks), ms.String(), "circuit-trip", trip(send)))
	h1 := h0 + 2*circuitAuthorityTripBlocks

	// governance confirms it: no lapse
	require.NoError(t, cgSet(app, at(h1+10), gov, "circuit-trip", trip(send)))
	require.False(t, allowed(at(h1+10*circuitAuthorityTripBlocks), send))

	// after a reset the authority waits; governance does not
	require.NoError(t, cgSet(app, at(h1+20), gov, "circuit-reset", trip(send)))
	require.True(t, allowed(at(h1+20), send))
	require.ErrorIs(t, cgSet(app, at(h1+21), ms.String(), "circuit-trip", trip(send)), ErrCircuit, "no re-trip after a reset")
	require.NoError(t, cgSet(app, at(h1+21), gov, "circuit-trip", trip(send)))
	require.NoError(t, cgSet(app, at(h1+22), ms.String(), "circuit-reset", trip(send)), "the authority may reset")
	require.ErrorIs(t, cgSet(app, at(h1+23), ms.String(), "circuit-trip", trip(send)), ErrCircuit, "and then waits as well")
	require.NoError(t, cgSet(app, at(h1+22+circuitAuthorityTripBlocks), ms.String(), "circuit-trip", trip(send)))

	// genesis may carry the wait keys; the export drops them (heights of this chain)
	_, err = pqParseGenesis([]byte(`[{"key":"51","value":"00"}]`))
	require.NoError(t, err)
	out, err := app.pqExportGenesis(at(h1 + 30))
	require.NoError(t, err)
	require.NotContains(t, string(out), `"key":"51`)
}
