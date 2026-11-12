//go:build test

package evmd

// The chain guard (zetaphy_chainguard.go) and the start guard
// (zetaphy_antirollback.go): crypto downgrade, voting-power cap, circuit
// breaker, constitution, the zetaphy-guard upgrade, and the start checks.

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	cmtcfg "github.com/cometbft/cometbft/config"
	cmtstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"

	wasmtypes "github.com/CosmWasm/wasmd/x/wasm/types"
	dbm "github.com/cosmos/cosmos-db"

	sdkmath "cosmossdk.io/math"

	"github.com/cosmos/cosmos-sdk/client/flags"
	"github.com/cosmos/cosmos-sdk/crypto/keys/ed25519"
	"github.com/cosmos/cosmos-sdk/crypto/keys/multisig"
	"github.com/cosmos/cosmos-sdk/crypto/keys/secp256k1"
	cryptotypes "github.com/cosmos/cosmos-sdk/crypto/types"
	storetypes "github.com/cosmos/cosmos-sdk/store/v2/types"
	simtestutil "github.com/cosmos/cosmos-sdk/testutil/sims"
	sdk "github.com/cosmos/cosmos-sdk/types"
	"github.com/cosmos/cosmos-sdk/types/module"
	"github.com/cosmos/cosmos-sdk/x/authz"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	govv1 "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	minttypes "github.com/cosmos/cosmos-sdk/x/mint/types"
	stakingkeeper "github.com/cosmos/cosmos-sdk/x/staking/keeper"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	upgradetypes "github.com/cosmos/cosmos-sdk/x/upgrade/types"

	"github.com/cosmos/evm/crypto/ethsecp256k1"
	evmtypes "github.com/cosmos/evm/x/vm/types"
)

// cgApp: v5 on and the chain guard active from block 1.
func cgApp(t *testing.T) (*EVMD, sdk.Context) {
	app, ctx := futApp(t)
	app.setGuardHeight(ctx, 1)
	require.True(t, app.guardActive(ctx))
	return app, ctx
}

func cgSet(app *EVMD, ctx sdk.Context, authority, kind string, v any) error {
	data, ok := v.([]byte)
	if !ok {
		data, _ = json.Marshal(v)
	}
	_, err := app.setFuture(ctx, &MsgSetFuture{Authority: authority, Kind: kind, Data: data})
	return err
}

func cgTx(t *testing.T, app *EVMD, msgs ...sdk.Msg) sdk.Tx {
	b := app.GetTxConfig().NewTxBuilder()
	require.NoError(t, b.SetMsgs(msgs...))
	b.SetGasLimit(500000)
	return b.GetTx()
}

// cgAccount: an account whose public key pk is on chain.
func cgAccount(t *testing.T, app *EVMD, ctx sdk.Context, pk cryptotypes.PubKey) sdk.AccAddress {
	addr := sdk.AccAddress(pk.Address())
	pqFund(t, app, ctx, addr, secOne())
	acc := app.AccountKeeper.GetAccount(ctx, addr)
	require.NoError(t, acc.SetPubKey(pk))
	app.AccountKeeper.SetAccount(ctx, acc)
	return addr
}

// Before the guard height every new path answers exactly what the binary
// without it answers (same error, same gas): a mixed validator set agrees.
func TestChainGuardOffBeforeHeight(t *testing.T) {
	app, ctx := futApp(t)
	require.False(t, app.guardActive(ctx))
	gasOf := func(kind string) (uint64, string) {
		c := ctx.WithGasMeter(storetypes.NewInfiniteGasMeter())
		err := cgSet(app, c, secGovAddr(), kind, map[string]any{"msgs": []string{"/cosmos.bank.v1beta1.MsgSend"}})
		require.Error(t, err)
		return c.GasMeter().GasConsumed(), err.Error()
	}
	baseGas, baseErr := gasOf("no-such-kind")
	for _, k := range []string{"sig-algos", "power-cap", "circuit-authority", "circuit-trip", "circuit-reset", "constitution"} {
		g, e := gasOf(k)
		require.Equal(t, baseGas, g, "kind %s: same gas as an unknown kind", k)
		require.Equal(t, strings.Replace(baseErr, `"no-such-kind"`, fmt.Sprintf("%q", k), 1), e, "kind %s: the old binary's error text", k)
	}
	// The circuit breaker, ante checks, Q-day rule and router wrapper are no-ops.
	ok, err := zetaphyCircuit{app}.IsAllowed(ctx, "/cosmos.bank.v1beta1.MsgSend")
	require.True(t, ok)
	require.NoError(t, err)
	require.NoError(t, app.guardCheckTx(ctx, cgTx(t, app, &evmtypes.MsgEthereumTx{})))
	require.NoError(t, app.qdayGuard(ctx))
	require.NoError(t, app.constitutionCheck(ctx, &wasmtypes.MsgSudoContract{}))
	// The hooks never touch the store.
	before := pqStoreDigest(app, ctx)
	h := powerCapHooks{app}
	val := sdk.ValAddress(make([]byte, 20))
	require.NoError(t, h.BeforeDelegationSharesModified(ctx, nil, val))
	require.NoError(t, h.BeforeDelegationRemoved(ctx, nil, val))
	require.NoError(t, h.AfterDelegationModified(ctx, nil, val))
	require.Equal(t, before, pqStoreDigest(app, ctx))
}

func pqStoreDigest(app *EVMD, ctx sdk.Context) string {
	it := app.secRaw(ctx).Iterator(nil, nil)
	defer it.Close()
	s := ""
	for ; it.Valid(); it.Next() {
		s += fmt.Sprintf("%x=%x;", it.Key(), it.Value())
	}
	return s
}

func TestChainGuardUpgradeHandler(t *testing.T) {
	app, ctx := futApp(t)
	require.True(t, zetaphyEarlyUpgrades[ZetaphyGuardUpgradeName], "zetaphy-guard adds no store: it may run early")
	require.NoError(t, app.UpgradeKeeper.ScheduleUpgrade(upgAt(ctx, 40), upgradetypes.Plan{Name: ZetaphyGuardUpgradeName, Height: 50}))
	for h := int64(41); h < 50; h++ {
		_, err := app.ModuleManager.PreBlock(upgAt(ctx, h))
		require.NoError(t, err, "block %d: the new binary goes on before the height", h)
		require.False(t, app.guardActive(upgAt(ctx, h)))
	}
	_, err := app.ModuleManager.PreBlock(upgAt(ctx, 50))
	require.NoError(t, err)
	require.Equal(t, int64(51), app.guardHeight(ctx))
	require.False(t, app.guardActive(upgAt(ctx, 50)))
	require.True(t, app.guardActive(upgAt(ctx, 51)))
	require.Equal(t, uint64(powerCapDefault), app.powerCapBps(ctx), "default cap 3333 bps")
	_, on := app.constitution(ctx)
	require.False(t, on, "the constitution stays off")
	require.Equal(t, sigAlgos{Enabled: []string{"eth_secp256k1", "mldsa44", "secp256k1"}, Retired: []string{}}, app.sigAlgos(ctx))
}

// T: the algorithm list only moves forward; retired never comes back.
func TestChainGuardSigAlgos(t *testing.T) {
	app, ctx := cgApp(t)
	gov := secGovAddr()
	set := func(v any) error { return cgSet(app, ctx, gov, "sig-algos", v) }
	require.ErrorContains(t, cgSet(app, ctx, sdk.AccAddress(make([]byte, 20)).String(), "sig-algos", map[string]any{"version": 1, "retire": []string{"secp256k1"}}), "only governance")
	require.ErrorIs(t, set(map[string]any{"version": 2, "retire": []string{"secp256k1"}}), ErrSigAlgo, "versions go one at a time")
	require.ErrorIs(t, set(map[string]any{"version": 1, "retire": []string{"mldsa44"}}), ErrSigAlgo, "the PQ algorithm cannot be retired")
	require.ErrorContains(t, set(map[string]any{"version": 1, "enable": []string{"rsa"}}), "not an algorithm")
	require.NoError(t, set(map[string]any{"version": 1, "retire": []string{"secp256k1"}}))
	require.Equal(t, sigAlgos{Version: 1, Enabled: []string{"eth_secp256k1", "mldsa44"}, Retired: []string{"secp256k1"}}, app.sigAlgos(ctx))
	require.ErrorIs(t, set(map[string]any{"version": 2, "enable": []string{"secp256k1"}}), ErrSigAlgo, "a retired algorithm is never enabled again")
	require.ErrorIs(t, set(map[string]any{"version": 1, "retire": []string{"eth_secp256k1"}}), ErrSigAlgo, "no going back to version 1")

	// The ante rule: a secp256k1 signer (alone or in a multisig) is refused, others pass.
	sk := secp256k1.GenPrivKey().PubKey()
	ek, _ := ethsecp256k1.GenerateKey()
	cosmosAcc := cgAccount(t, app, ctx, sk)
	ethAcc := cgAccount(t, app, ctx, ek.PubKey())
	pq := secPQAccount(t, app, ctx)
	ms := cgAccount(t, app, ctx, multisig.NewLegacyAminoPubKey(2, []cryptotypes.PubKey{ek.PubKey(), secp256k1.GenPrivKey().PubKey()}))
	send := func(a sdk.AccAddress) sdk.Msg {
		return &banktypes.MsgSend{FromAddress: a.String(), ToAddress: a.String(), Amount: sdk.NewCoins(sdk.NewInt64Coin(evmtypes.GetEVMCoinDenom(), 1))}
	}
	require.ErrorIs(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(cosmosAcc))), ErrSigAlgo)
	require.ErrorIs(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(ms))), ErrSigAlgo, "a multisig sub-key counts")
	require.NoError(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(ethAcc))))
	require.NoError(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(pq))))
	require.NoError(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, &evmtypes.MsgEthereumTx{From: ethAcc.Bytes()})))

	require.NoError(t, set(map[string]any{"version": 2, "retire": []string{"eth_secp256k1"}}))
	require.ErrorContains(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, &evmtypes.MsgEthereumTx{From: ethAcc.Bytes()})), "Ethereum transactions are refused")
	exec := authz.NewMsgExec(pq, []sdk.Msg{&evmtypes.MsgEthereumTx{From: ethAcc.Bytes()}})
	require.ErrorIs(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, &exec)), ErrSigAlgo, "inside authz too")
	require.ErrorIs(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(ethAcc))), ErrSigAlgo)
	require.NoError(t, app.sigAlgoCheckTx(ctx, cgTx(t, app, send(pq))), "ML-DSA-44 keeps working")
	require.ErrorIs(t, set(map[string]any{"version": 3, "retire": []string{"mldsa44"}}), ErrSigAlgo, "the last PQ algorithm stays")
}

// T: once Q-day has passed nothing brings ECDSA back; quantum locks stay PQ.
func TestChainGuardNoWayBackToECDSA(t *testing.T) {
	app, ctx := cgApp(t)
	secSetQDay(t, app, ctx, 50, 5)
	after := ctx.WithBlockHeight(60)
	for _, m := range []*MsgSetQDay{{Authority: secGovAddr(), Height: 0}, {Authority: secGovAddr(), Height: 1000}} {
		_, err := app.setQDay(after, m)
		require.ErrorIs(t, err, ErrSigAlgo, "Q-day passed: neither unscheduled nor moved")
	}
	h, _ := app.qdayParams(after)
	require.Equal(t, int64(50), h)
	_, err := app.setQDay(ctx, &MsgSetQDay{Authority: secGovAddr(), Height: 0})
	require.NoError(t, err, "before Q-day governance may still unschedule it")

	// Without the guard (the binary before zetaphy-guard) unscheduling after Q-day worked.
	app2, ctx2 := futApp(t)
	secSetQDay(t, app2, ctx2, 50, 5)
	_, err = app2.setQDay(ctx2.WithBlockHeight(60), &MsgSetQDay{Authority: secGovAddr(), Height: 0})
	require.NoError(t, err)

	// A quantum lock cannot be handed to an ECDSA account, and there is no unlock message.
	ek, _ := ethsecp256k1.GenerateKey()
	owner := cgAccount(t, app, ctx, ek.PubKey())
	pq := secPQAccount(t, app, ctx)
	app.applyQuantumLock(ctx, owner, pq)
	ek2, _ := ethsecp256k1.GenerateKey()
	ecdsa := cgAccount(t, app, ctx, ek2.PubKey())
	_, err = app.quantumLock(ctx, &MsgQuantumLock{Signer: pq.String(), Owner: owner.String(), Controller: ecdsa.String()})
	require.ErrorContains(t, err, "ML-DSA-44")
	require.Equal(t, []byte(pq), app.pqController(ctx, owner))
	for _, d := range pqMsgDefs {
		require.NotContains(t, d.name, "Unlock", "no message removes a quantum lock")
	}
}

// S: the voting-power cap, only with 4+ active validators, only on additions.
func TestChainGuardPowerCap(t *testing.T) {
	app, ctx := cgApp(t)
	ctx = ctx.WithExecMode(sdk.ExecModeFinalize)
	bond, err := app.StakingKeeper.BondDenom(ctx)
	require.NoError(t, err)
	one := sdk.DefaultPowerReduction
	srv := stakingkeeper.NewMsgServerImpl(app.StakingKeeper)
	fund := func(a sdk.AccAddress, amt sdkmath.Int) {
		c := sdk.NewCoins(sdk.NewCoin(bond, amt))
		require.NoError(t, app.BankKeeper.MintCoins(ctx, minttypes.ModuleName, c))
		require.NoError(t, app.BankKeeper.SendCoinsFromModuleToAccount(ctx, minttypes.ModuleName, a, c))
	}
	newVal := func(i byte, self sdkmath.Int) sdk.ValAddress {
		op := sdk.AccAddress(append([]byte{0xc0, i}, make([]byte, 18)...))
		fund(op, self.MulRaw(10))
		pk := ed25519.GenPrivKeyFromSecret([]byte{i, 'c', 'g'}).PubKey()
		m, err := stakingtypes.NewMsgCreateValidator(sdk.ValAddress(op).String(), pk, sdk.NewCoin(bond, self), stakingtypes.Description{Moniker: fmt.Sprint(i)},
			stakingtypes.NewCommissionRates(sdkmath.LegacyNewDecWithPrec(1, 1), sdkmath.LegacyNewDecWithPrec(2, 1), sdkmath.LegacyNewDecWithPrec(1, 2)), sdkmath.OneInt())
		require.NoError(t, err)
		_, err = srv.CreateValidator(ctx, m)
		require.NoError(t, err)
		return sdk.ValAddress(op)
	}
	delegate := func(val sdk.ValAddress, amt sdkmath.Int) error {
		c, _ := ctx.CacheContext()
		d := sdk.AccAddress(append([]byte{0xd0}, make([]byte, 19)...))
		_, err := srv.Delegate(c, &stakingtypes.MsgDelegate{DelegatorAddress: d.String(), ValidatorAddress: val.String(), Amount: sdk.NewCoin(bond, amt)})
		return err
	}
	fund(sdk.AccAddress(append([]byte{0xd0}, make([]byte, 19)...)), one.MulRaw(1000))
	update := func() {
		_, err := app.StakingKeeper.ApplyAndReturnValidatorSetUpdates(ctx)
		require.NoError(t, err)
	}
	// Genesis has 1 validator with `one`. Two more: 3 active, no cap.
	v1 := newVal(1, one)
	v2 := newVal(2, one)
	update()
	set, _ := app.StakingKeeper.GetLastValidators(ctx)
	require.Len(t, set, 3)
	require.NoError(t, delegate(v1, one.MulRaw(5)), "3 validators: never refused (testnet, CI devnets)")
	// A fourth: 4 equal validators of 25% each.
	newVal(3, one)
	update()
	set, _ = app.StakingKeeper.GetLastValidators(ctx)
	require.Len(t, set, 4)
	err = delegate(v1, one)
	require.ErrorIs(t, err, ErrPowerCap, "2/5 = 40%% > 33.33%%")
	require.NoError(t, delegate(v1, one.QuoRaw(5)), "1.2/4.2 = 28.6%% is fine")
	// Self-bond above the cap: a fifth validator with most of the stake.
	op := sdk.AccAddress(append([]byte{0xc0, 9}, make([]byte, 18)...))
	fund(op, one.MulRaw(100))
	pk := ed25519.GenPrivKeyFromSecret([]byte{9, 'c', 'g'}).PubKey()
	m, err := stakingtypes.NewMsgCreateValidator(sdk.ValAddress(op).String(), pk, sdk.NewCoin(bond, one.MulRaw(10)), stakingtypes.Description{Moniker: "big"},
		stakingtypes.NewCommissionRates(sdkmath.LegacyNewDecWithPrec(1, 1), sdkmath.LegacyNewDecWithPrec(2, 1), sdkmath.LegacyNewDecWithPrec(1, 2)), sdkmath.OneInt())
	require.NoError(t, err)
	c, _ := ctx.CacheContext()
	_, err = srv.CreateValidator(c, m)
	require.ErrorIs(t, err, ErrPowerCap, "a self-bond counts as an addition")
	// Lower cap: everyone is above it, yet undelegating is never blocked.
	require.NoError(t, cgSet(app, ctx, secGovAddr(), "power-cap", map[string]any{"max_bps": 2000}))
	self := sdk.AccAddress(v1)
	_, err = srv.Undelegate(ctx, &stakingtypes.MsgUndelegate{DelegatorAddress: self.String(), ValidatorAddress: v1.String(), Amount: sdk.NewCoin(bond, one.QuoRaw(2))})
	require.NoError(t, err)
	require.ErrorIs(t, delegate(v2, sdkmath.OneInt()), ErrPowerCap, "v2 holds 1/3.5 = 28.6%% > 20%%")
	require.NoError(t, cgSet(app, ctx, secGovAddr(), "power-cap", map[string]any{"max_bps": 0}))
	require.NoError(t, delegate(v1, one.MulRaw(50)), "cap 0 = off")
	require.ErrorContains(t, cgSet(app, ctx, secGovAddr(), "power-cap", map[string]any{"max_bps": 10001}), "max_bps")
	require.Nil(t, app.secRaw(ctx).Get(powerStashKey(v1)), "the scratch key never stays")
}

// S: the circuit breaker; its authority must be a multisig, governance always can.
func TestChainGuardCircuit(t *testing.T) {
	app, ctx := cgApp(t)
	gov := secGovAddr()
	single := cgAccount(t, app, ctx, secp256k1.GenPrivKey().PubKey())
	k1, k2, k3 := secp256k1.GenPrivKey().PubKey(), secp256k1.GenPrivKey().PubKey(), secp256k1.GenPrivKey().PubKey()
	ms := cgAccount(t, app, ctx, multisig.NewLegacyAminoPubKey(2, []cryptotypes.PubKey{k1, k2, k3}))
	weak := cgAccount(t, app, ctx, multisig.NewLegacyAminoPubKey(1, []cryptotypes.PubKey{k1, k2}))
	send := "/cosmos.bank.v1beta1.MsgSend"
	trip := map[string]any{"msgs": []string{send}}

	require.ErrorContains(t, cgSet(app, ctx, ms.String(), "circuit-trip", trip), "only governance or the circuit authority", "no authority yet")
	require.ErrorContains(t, cgSet(app, ctx, ms.String(), "circuit-authority", map[string]string{"address": ms.String()}), "only governance")
	require.ErrorContains(t, cgSet(app, ctx, gov, "circuit-authority", map[string]string{"address": gov}), "name a multisig")
	for _, a := range []sdk.AccAddress{single, weak} {
		require.NoError(t, cgSet(app, ctx, gov, "circuit-authority", map[string]string{"address": a.String()}))
		require.ErrorIs(t, cgSet(app, ctx, a.String(), "circuit-trip", trip), ErrCircuit, "a single key (or threshold 1) cannot trip")
	}
	require.NoError(t, cgSet(app, ctx, gov, "circuit-authority", map[string]string{"address": ms.String()}))
	require.ErrorContains(t, cgSet(app, ctx, single.String(), "circuit-trip", trip), "only governance or the circuit authority")
	for _, p := range []string{"/cosmos.gov.v1.MsgVote", "/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", "/zetaphy.pq.v1.MsgSetFuture", "/zetaphy.pq.v1.MsgPQCertificate"} {
		require.ErrorIs(t, cgSet(app, ctx, ms.String(), "circuit-trip", map[string]any{"msgs": []string{p}}), ErrCircuit, "%s stays available", p)
	}
	require.ErrorContains(t, cgSet(app, ctx, ms.String(), "circuit-trip", map[string]any{"msgs": []string{"/no.such.Msg"}}), "not a message")

	require.NoError(t, cgSet(app, ctx, ms.String(), "circuit-trip", trip), "the multisig authority trips")
	a := sdk.AccAddress(make([]byte, 20))
	msg := &banktypes.MsgSend{FromAddress: single.String(), ToAddress: a.String(), Amount: sdk.NewCoins(sdk.NewInt64Coin(evmtypes.GetEVMCoinDenom(), 1))}
	_, err := app.MsgServiceRouter().Handler(msg)(ctx, msg)
	require.ErrorIs(t, err, ErrCircuit, "refused where it runs")
	require.ErrorIs(t, app.guardCheckTx(ctx, cgTx(t, app, msg)), ErrCircuit, "and at CheckTx")
	exec := authz.NewMsgExec(single, []sdk.Msg{msg})
	require.ErrorIs(t, app.guardCheckTx(ctx, cgTx(t, app, &exec)), ErrCircuit, "inside authz too")
	_, err = app.GovKeeper.Router().Handler(msg)(ctx, msg)
	require.ErrorIs(t, err, ErrCircuit, "and from a governance proposal")

	require.NoError(t, cgSet(app, ctx, gov, "circuit-reset", trip), "governance resets")
	_, err = app.MsgServiceRouter().Handler(msg)(ctx, msg)
	require.NoError(t, err)
	require.NoError(t, cgSet(app, ctx, gov, "circuit-trip", trip), "governance trips")
	require.NoError(t, cgSet(app, ctx, ms.String(), "circuit-reset", trip), "the authority resets")
}

// P: the constitution, on (the default is off: nothing changes).
func TestChainGuardConstitution(t *testing.T) {
	app, ctx := cgApp(t)
	gov := secGovAddr()
	sp, err := app.StakingKeeper.GetParams(ctx)
	require.NoError(t, err)
	shorter := sp
	shorter.UnbondingTime = sp.UnbondingTime - time.Hour
	lower := &stakingtypes.MsgUpdateParams{Authority: gov, Params: shorter}
	sudo := &wasmtypes.MsgSudoContract{Authority: gov, Contract: sdk.AccAddress(make([]byte, 32)).String(), Msg: []byte(`{}`)}
	require.NoError(t, app.constitutionCheck(ctx, lower), "off by default: governance may do it")
	require.NoError(t, app.constitutionCheck(ctx, sudo))

	require.ErrorContains(t, cgSet(app, ctx, gov, "constitution", map[string]bool{"enabled": false}), "off already")
	require.NoError(t, cgSet(app, ctx, gov, "constitution", map[string]bool{"enabled": true}))
	c, on := app.constitution(ctx)
	require.True(t, on)
	require.Equal(t, sp.UnbondingTime, c.UnbondingTime)

	require.ErrorIs(t, app.constitutionCheck(ctx, lower), ErrConstitution, "unbonding below its floor")
	require.ErrorIs(t, app.constitutionCheck(ctx, sudo), ErrConstitution, "no sudo")
	longer := sp
	longer.UnbondingTime = sp.UnbondingTime + time.Hour
	require.NoError(t, app.constitutionCheck(ctx, &stakingtypes.MsgUpdateParams{Authority: gov, Params: longer}), "a longer unbonding is fine")
	other := sp
	other.BondDenom = "other"
	require.ErrorIs(t, app.constitutionCheck(ctx, &stakingtypes.MsgUpdateParams{Authority: gov, Params: other}), ErrConstitution)

	gp, err := app.GovKeeper.Params.Get(ctx)
	require.NoError(t, err)
	fast := gp
	vp := *gp.VotingPeriod / 2
	fast.VotingPeriod = &vp
	require.ErrorIs(t, app.constitutionCheck(ctx, &govv1.MsgUpdateParams{Authority: gov, Params: fast}), ErrConstitution, "shorter voting period")
	lowQ := gp
	lowQ.Quorum = "0.01"
	require.ErrorIs(t, app.constitutionCheck(ctx, &govv1.MsgUpdateParams{Authority: gov, Params: lowQ}), ErrConstitution, "lower quorum")
	require.NoError(t, app.constitutionCheck(ctx, &govv1.MsgUpdateParams{Authority: gov, Params: gp}), "the same params")

	mp, err := app.MintKeeper.Params.Get(ctx)
	require.NoError(t, err)
	more := mp
	more.InflationMax = mp.InflationMax.Add(sdkmath.LegacyNewDecWithPrec(1, 2))
	require.ErrorIs(t, app.constitutionCheck(ctx, &minttypes.MsgUpdateParams{Authority: gov, Params: more}), ErrConstitution, "no new mint")
	fewer := mp
	fewer.BlocksPerYear = mp.BlocksPerYear / 2
	require.ErrorIs(t, app.constitutionCheck(ctx, &minttypes.MsgUpdateParams{Authority: gov, Params: fewer}), ErrConstitution, "fewer blocks per year mints more per block")
	less := mp
	less.InflationMax = mp.InflationMin
	require.NoError(t, app.constitutionCheck(ctx, &minttypes.MsgUpdateParams{Authority: gov, Params: less}), "less inflation is fine")

	ep := app.EVMKeeper.GetParams(ctx)
	ep.EvmDenom = "other"
	require.ErrorIs(t, app.constitutionCheck(ctx, &evmtypes.MsgUpdateParams{Authority: gov, Params: ep}), ErrConstitution)
	require.ErrorIs(t, app.constitutionCheck(ctx, &MsgSetQDay{Authority: gov, Height: 1000, RevealDelay: QDayMinRevealDelay}), ErrConstitution, "shorter reveal delay")
	require.NoError(t, app.constitutionCheck(ctx, &MsgSetQDay{Authority: gov, Height: 1000}), "the default delay")
	for _, cap := range []uint64{0, 5000} {
		data, _ := json.Marshal(map[string]uint64{"max_bps": cap})
		require.ErrorIs(t, app.constitutionCheck(ctx, &MsgSetFuture{Authority: gov, Kind: "power-cap", Data: data}), ErrConstitution, "cap %d", cap)
	}
	data, _ := json.Marshal(map[string]uint64{"max_bps": 2500})
	require.NoError(t, app.constitutionCheck(ctx, &MsgSetFuture{Authority: gov, Kind: "power-cap", Data: data}), "a stricter cap is fine")
	require.ErrorIs(t, app.constitutionCheck(ctx, &MsgSetFuture{Authority: gov, Kind: "constitution", Data: []byte(`{"enabled":false}`)}), ErrConstitution)
	require.ErrorIs(t, cgSet(app, ctx, gov, "constitution", map[string]bool{"enabled": false}), ErrConstitution, "it cannot be turned off")

	// Submission (Cosmos tx) and execution (every path) refuse it.
	prop, err := govv1.NewMsgSubmitProposal([]sdk.Msg{lower}, sdk.NewCoins(), sdk.AccAddress(make([]byte, 20)).String(), "", "t", "s", false)
	require.NoError(t, err)
	require.ErrorIs(t, app.guardCheckTx(ctx, cgTx(t, app, prop)), ErrConstitution, "refused at submission")
	ok, err := govv1.NewMsgSubmitProposal([]sdk.Msg{&stakingtypes.MsgUpdateParams{Authority: gov, Params: longer}}, sdk.NewCoins(), sdk.AccAddress(make([]byte, 20)).String(), "", "t", "s", false)
	require.NoError(t, err)
	require.NoError(t, app.guardCheckTx(ctx, cgTx(t, app, ok)))
	_, err = app.GovKeeper.Router().Handler(lower)(ctx, lower)
	require.ErrorIs(t, err, ErrConstitution, "refused when the proposal runs")
	_, err = app.GovKeeper.Router().Handler(lower)(ctx, &stakingtypes.MsgUpdateParams{Authority: gov, Params: longer})
	require.NoError(t, err, "an allowed proposal runs")
	sp2, _ := app.StakingKeeper.GetParams(ctx)
	require.Equal(t, longer.UnbondingTime, sp2.UnbondingTime)
}

// ---- the start guard

func sgWriteJSON(t *testing.T, p string, v any) {
	bz, err := json.Marshal(v)
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Dir(p), 0o755))
	require.NoError(t, os.WriteFile(p, bz, 0o600))
}

// L1-1: a binary without the handler of the chain's last upgrade does not start.
func TestStartGuardDowngrade(t *testing.T) {
	const name, h = "zetaphy-v99", int64(10)
	db, home := dbm.NewMemDB(), t.TempDir()
	prev := restartChain(t, db, home)
	restartComplete(t, prev, ZetaphyGuardUpgradeName, 5)
	prev.UpgradeKeeper.SetUpgradeHandler(name, func(_ context.Context, _ upgradetypes.Plan, vm module.VersionMap) (module.VersionMap, error) {
		return vm, nil
	})
	restartComplete(t, prev, name, h)

	app := restartNewApp(t, db, home)
	opts := simtestutil.AppOptionsMap{flags.FlagHome: home}
	err := app.ZetaphyStartGuard(opts)
	require.ErrorContains(t, err, `no handler for "zetaphy-v99"`)
	require.ErrorContains(t, err, ZetaphyAllowDowngradeEnv+"="+app.ChainID()+":")
	t.Setenv(ZetaphyAllowDowngradeEnv, app.ChainID()+":1")
	require.Error(t, app.ZetaphyStartGuard(opts), "an override for another height is ignored")
	t.Setenv(ZetaphyAllowDowngradeEnv, "other-chain:"+fmt.Sprint(app.LastBlockHeight()))
	require.Error(t, app.ZetaphyStartGuard(opts), "or another chain")
	t.Setenv(ZetaphyAllowDowngradeEnv, fmt.Sprintf("%s:%d", app.ChainID(), app.LastBlockHeight()))
	require.NoError(t, app.ZetaphyStartGuard(opts), "the exact override starts it (logged)")

	// The same binary on a chain whose last upgrade it has (zetaphy-guard): starts.
	db2, home2 := dbm.NewMemDB(), t.TempDir()
	restartComplete(t, restartChain(t, db2, home2), ZetaphyGuardUpgradeName, 5)
	t.Setenv(ZetaphyAllowDowngradeEnv, "")
	require.NoError(t, restartNewApp(t, db2, home2).ZetaphyStartGuard(simtestutil.AppOptionsMap{flags.FlagHome: home2}))
}

// L1-2: a validator whose priv_validator_state.json is behind does not start.
func TestStartGuardSignState(t *testing.T) {
	db, home := dbm.NewMemDB(), t.TempDir()
	restartChain(t, db, home)
	app := restartNewApp(t, db, home)
	opts := simtestutil.AppOptionsMap{flags.FlagHome: home}
	addr := make([]byte, 20)
	addr[0] = 0xab
	sgWriteJSON(t, filepath.Join(home, "config", "priv_validator_key.json"), map[string]string{"address": fmt.Sprintf("%X", addr)})
	sgWriteJSON(t, filepath.Join(home, "config", "genesis.json"), map[string]string{"chain_id": app.ChainID()})
	pvs := func(h int64) {
		sgWriteJSON(t, filepath.Join(home, "data", "priv_validator_state.json"), map[string]any{"height": fmt.Sprint(h), "round": 0, "step": 3})
	}
	pvs(100)
	require.NoError(t, app.ZetaphyStartGuard(opts), "no record, no block store: starts")

	// The sign record (written from ExtendVote) is ahead of the state file.
	rec := newZetaphySignRecord(home)
	other := append([]byte{0xcd}, addr[1:]...)
	rec.note(app.ChainID(), 130, other) // another validator key's record (internal review 2026-11-12, Z-50)
	require.NoError(t, app.ZetaphyStartGuard(opts), "a record of another key does not count")
	rec.note(app.ChainID(), 120, addr) // this key: starts afresh
	rec.note(app.ChainID(), 110, addr) // never goes down
	st, ok := readSignState(filepath.Join(home, "config", zetaphySignStateFn))
	require.True(t, ok)
	require.Equal(t, int64(120), st.Height)
	require.Equal(t, fmt.Sprintf("%x", addr), st.ConsAddress)
	_, err := os.Stat(filepath.Join(home, "config", zetaphySignStateFn+".tmp"))
	require.True(t, os.IsNotExist(err), "written through a temporary file, renamed")
	err = app.ZetaphyStartGuard(opts)
	require.ErrorContains(t, err, "double sign")
	require.ErrorContains(t, err, "height 120")
	pvs(120)
	require.NoError(t, app.ZetaphyStartGuard(opts), "the newest state file")
	require.NoError(t, os.Remove(filepath.Join(home, "data", "priv_validator_state.json")))
	require.ErrorContains(t, app.ZetaphyStartGuard(opts), "is missing")

	// A remote signer is not checked; another genesis does not inherit the record.
	require.NoError(t, app.ZetaphyStartGuard(simtestutil.AppOptionsMap{flags.FlagHome: home, "priv_validator_laddr": "tcp://127.0.0.1:1234"}))
	sgWriteJSON(t, filepath.Join(home, "config", "genesis.json"), map[string]string{"chain_id": app.ChainID(), "x": "new chain"})
	pvs(0)
	require.NoError(t, app.ZetaphyStartGuard(opts))
	sgWriteJSON(t, filepath.Join(home, "config", "genesis.json"), map[string]string{"chain_id": app.ChainID()})

	// The override starts it once and resets the record to the state file.
	require.Error(t, app.ZetaphyStartGuard(opts))
	t.Setenv(ZetaphyAllowDowngradeEnv, fmt.Sprintf("%s:%d", app.ChainID(), app.LastBlockHeight()))
	require.NoError(t, app.ZetaphyStartGuard(opts))
	t.Setenv(ZetaphyAllowDowngradeEnv, "")
	require.NoError(t, app.ZetaphyStartGuard(opts), "the record now matches the state file")

	// The block store: this validator's signature in the newest commit.
	require.NoError(t, os.Remove(filepath.Join(home, "config", zetaphySignStateFn)))
	c := cmtcfg.DefaultConfig()
	c.SetRoot(home)
	bdb, err := cmtcfg.DefaultDBProvider(&cmtcfg.DBContext{ID: "blockstore", Config: c})
	require.NoError(t, err)
	bs := cmtstore.NewBlockStore(bdb)
	blk := cmttypes.MakeBlock(1, nil, &cmttypes.Commit{}, nil)
	parts, err := blk.MakePartSet(cmttypes.BlockPartSizeBytes)
	require.NoError(t, err)
	seen := &cmttypes.Commit{Height: 1, BlockID: cmttypes.BlockID{Hash: blk.Hash(), PartSetHeader: parts.Header()},
		Signatures: []cmttypes.CommitSig{{BlockIDFlag: cmttypes.BlockIDFlagCommit, ValidatorAddress: addr, Timestamp: time.Now(), Signature: []byte{1}}}}
	bs.SaveBlock(blk, parts, seen)
	require.NoError(t, bs.Close())
	require.ErrorContains(t, app.ZetaphyStartGuard(opts), "the block store has this validator's signature at height 1")
	pvs(1)
	require.NoError(t, app.ZetaphyStartGuard(opts))
}
