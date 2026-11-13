package evmd

// Per-node faucet amounts and the daily ZTPHY budget (evmd/zetaphy_faucetlimits.go):
// config/faucet-amount, config/faucet-pow-amount and config/faucet-day-budget,
// through the same JSON-RPC server and stand-in backend as zetaphy_faucetpow_test.go.
// The values are the mainnet sentry's (owner decision 2026-11-13): 1 ZTPHY a
// zetaphy_faucet grant, 5 ZTPHY a proof, a budget for both together.

import (
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	ethtypes "github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/crypto"
)

func writeLimit(t *testing.T, home, name, v string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(home, "config", name), []byte(v+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func powInfo(t *testing.T, rpc powRPC) FaucetPowInfo {
	t.Helper()
	res, e := rpc.call(local, "zetaphy_faucetPowInfo")
	if e != "" {
		t.Fatal(e)
	}
	var info FaucetPowInfo
	if err := json.Unmarshal(res, &info); err != nil {
		t.Fatal(err)
	}
	return info
}

func wei(s string) *big.Int {
	v, err := parseZTPHY(s)
	if err != nil {
		panic(err)
	}
	return v
}

func TestSecurityFaucetLimitsParse(t *testing.T) {
	for in, want := range map[string]string{
		"1": "1000000000000000000", "5": "5000000000000000000", "200": "200000000000000000000",
		"0.5": "500000000000000000", "0.000000000000000001": "1", "10.25": "10250000000000000000",
	} {
		v, err := parseZTPHY(in)
		if err != nil || v.String() != want {
			t.Errorf("%q: %v %v", in, v, err)
		}
		if formatZTPHY(v) != in {
			t.Errorf("format %q: %q", in, formatZTPHY(v))
		}
	}
	for _, in := range []string{"", "-1", "+1", "1e3", "0x10", "1.", ".5", "1,5", "1 000", "0.0000000000000000001", "1234567890123456"} {
		if _, err := parseZTPHY(in); err == nil {
			t.Errorf("%q accepted", in)
		}
	}
}

func TestSecurityFaucetLimitsDefaults(t *testing.T) {
	// no files: the testnet's faucet, unchanged
	b, rpc, _ := newPowFaucet(t, "12")
	info := powInfo(t, rpc)
	if !info.Enabled || info.Reward.ToInt().Cmp(FaucetAmount) != 0 || info.FaucetReward.ToInt().Cmp(FaucetAmount) != 0 ||
		info.DayBudget != nil || info.RemainingBudget != nil || info.RemainingToday != FaucetPerDay || info.Problem != "" {
		t.Fatalf("info %+v", info)
	}
	faucet.Lock()
	want := crypto.PubkeyToAddress(faucet.key.PublicKey)
	faucet.Unlock()
	if info.Address != want {
		t.Errorf("address %s, want %s", info.Address, want)
	}
	a := common.BigToAddress(big.NewInt(0x3001))
	if _, e := rpc.call(local, "zetaphy_faucet", a.Hex()); e != "" {
		t.Fatal(e)
	}
	c := common.BigToAddress(big.NewInt(0x3002))
	if _, e := claim(rpc, c, b.latest, mine(t, b, c, b.latest, 12, 256)); e != "" {
		t.Fatal(e)
	}
	if len(b.sent) != 2 || b.sent[0].Value().Cmp(FaucetAmount) != 0 || b.sent[1].Value().Cmp(FaucetAmount) != 0 {
		t.Fatalf("sent %d", len(b.sent))
	}
	if FaucetAmount.Cmp(wei("10")) != 0 {
		t.Errorf("the testnet default changed: %s", FaucetAmount)
	}
}

func TestSecurityFaucetLimitsBudget(t *testing.T) {
	b, rpc, home := newPowFaucet(t, "12")
	writeLimit(t, home, faucetAmountFile, "1")
	writeLimit(t, home, faucetPowAmountFile, "5")
	writeLimit(t, home, faucetDayBudgetFile, "12")
	a := func(i int) common.Address { return common.BigToAddress(big.NewInt(int64(0x4000 + i))) }

	info := powInfo(t, rpc)
	if !info.Enabled || info.Reward.ToInt().Cmp(wei("5")) != 0 || info.FaucetReward.ToInt().Cmp(wei("1")) != 0 ||
		info.DayBudget.ToInt().Cmp(wei("12")) != 0 || info.RemainingBudget.ToInt().Cmp(wei("12")) != 0 || info.RemainingToday != 2 {
		t.Fatalf("info %+v", info)
	}

	// zetaphy_faucet: 1 ZTPHY
	res, e := rpc.call(local, "zetaphy_faucet", a(1).Hex())
	if e != "" {
		t.Fatal(e)
	}
	var fr FaucetResult
	_ = json.Unmarshal(res, &fr)
	if fr.Amount.ToInt().Cmp(wei("1")) != 0 || b.sent[0].Value().Cmp(wei("1")) != 0 {
		t.Fatalf("faucet grant %s", fr.Amount)
	}
	// zetaphy_faucetPow: 5 ZTPHY a proof
	if res, e = claim(rpc, a(2), b.latest, mine(t, b, a(2), b.latest, 12, 256)); e != "" {
		t.Fatal(e)
	}
	_ = json.Unmarshal(res, &fr)
	if fr.Amount.ToInt().Cmp(wei("5")) != 0 || b.sent[1].Value().Cmp(wei("5")) != 0 {
		t.Fatalf("proof grant %s", fr.Amount)
	}
	if info = powInfo(t, rpc); info.RemainingBudget.ToInt().Cmp(wei("6")) != 0 || info.RemainingToday != 1 {
		t.Errorf("after 6: %+v", info)
	}
	if _, e = claim(rpc, a(3), b.latest, mine(t, b, a(3), b.latest, 12, 256)); e != "" {
		t.Fatal(e)
	}
	// 11 of 12 given: a proof (5) no longer fits, a faucet grant (1) does
	n4 := mine(t, b, a(4), b.latest, 12, 256)
	if _, e = claim(rpc, a(4), b.latest, n4); !strings.Contains(e, "budget of 12 ZTPHY") {
		t.Errorf("proof over the budget: %q", e)
	}
	if info = powInfo(t, rpc); info.RemainingToday != 0 || info.RemainingBudget.ToInt().Cmp(wei("1")) != 0 {
		t.Errorf("after 11: %+v", info)
	}
	if _, e = rpc.call(local, "zetaphy_faucet", a(5).Hex()); e != "" {
		t.Errorf("faucet grant within the budget: %q", e)
	}
	if _, e = rpc.call(local, "zetaphy_faucet", a(6).Hex()); !strings.Contains(e, "budget") {
		t.Errorf("faucet grant over the budget: %q", e)
	}
	if len(b.sent) != 4 {
		t.Fatalf("sent %d", len(b.sent))
	}
	var total big.Int
	for _, tx := range b.sent {
		total.Add(&total, tx.Value())
	}
	if total.Cmp(wei("12")) != 0 {
		t.Errorf("given out %s", total.String())
	}

	// the next UTC day: a new budget, and the refused proof was not used up
	clock := faucetNow().Add(24 * time.Hour)
	faucetNow = func() time.Time { return clock }
	if info = powInfo(t, rpc); info.RemainingBudget.ToInt().Cmp(wei("12")) != 0 || info.RemainingToday != 2 {
		t.Errorf("next day: %+v", info)
	}
	if _, e = claim(rpc, a(4), b.latest, n4); e != "" {
		t.Errorf("next day, the same proof: %q", e)
	}

	// an address holding the faucet grant gets no faucet grant, but may still mine below the proof reward
	b.balance[a(7)] = wei("1")
	if _, e = rpc.call(local, "zetaphy_faucet", a(7).Hex()); !strings.Contains(e, "already has") {
		t.Errorf("funded address: %q", e)
	}
	if _, e = claim(rpc, a(7), b.latest, mine(t, b, a(7), b.latest, 12, 256)); e != "" {
		t.Errorf("1 ZTPHY held, proof of 5: %q", e)
	}

	// the files are read on every call: a lower amount and budget take effect at once
	writeLimit(t, home, faucetAmountFile, "0.5")
	writeLimit(t, home, faucetDayBudgetFile, "10.5") // 5 + 5 given today
	if info = powInfo(t, rpc); info.FaucetReward.ToInt().Cmp(wei("0.5")) != 0 || info.RemainingBudget.ToInt().Cmp(wei("0.5")) != 0 || info.RemainingToday != 0 {
		t.Errorf("changed files: %+v", info)
	}
	if res, e = rpc.call(local, "zetaphy_faucet", a(8).Hex()); e != "" {
		t.Fatal(e)
	}
	_ = json.Unmarshal(res, &fr)
	if fr.Amount.ToInt().Cmp(wei("0.5")) != 0 {
		t.Errorf("grant %s", fr.Amount)
	}
	if _, e = rpc.call(local, "zetaphy_faucet", a(9).Hex()); !strings.Contains(e, "budget of 10.5 ZTPHY") {
		t.Errorf("over the changed budget: %q", e)
	}
	// without the budget file, only the grant count limits the day
	if err := os.Remove(filepath.Join(home, "config", faucetDayBudgetFile)); err != nil {
		t.Fatal(err)
	}
	if info = powInfo(t, rpc); info.DayBudget != nil || info.RemainingBudget != nil || info.RemainingToday != FaucetPerDay-3 {
		t.Errorf("no budget: %+v", info)
	}
	if _, e = rpc.call(local, "zetaphy_faucet", a(9).Hex()); e != "" {
		t.Errorf("no budget: %q", e)
	}
}

func TestSecurityFaucetLimitsInvalid(t *testing.T) {
	// a file that is there but invalid turns the whole faucet off: never the larger default
	for _, c := range []struct{ file, v string }{
		{faucetAmountFile, "0"}, {faucetAmountFile, "-1"}, {faucetAmountFile, "abc"}, {faucetAmountFile, ""},
		{faucetAmountFile, "1e3"}, {faucetAmountFile, "100.000000000000000001"}, {faucetAmountFile, "0.0000000000000000001"},
		{faucetPowAmountFile, "0"}, {faucetPowAmountFile, "101"}, {faucetPowAmountFile, "5 ZTPHY"},
		{faucetDayBudgetFile, "0"}, {faucetDayBudgetFile, "100001"}, {faucetDayBudgetFile, "two hundred"},
	} {
		t.Run(c.file+"="+c.v, func(t *testing.T) {
			b, rpc, home := newPowFaucet(t, "12")
			writeLimit(t, home, c.file, c.v)
			info := powInfo(t, rpc)
			if info.Enabled || !strings.Contains(info.Problem, c.file) || info.Reward.ToInt().Sign() != 0 || info.RemainingToday != 0 {
				t.Errorf("info %+v", info)
			}
			to := common.BigToAddress(big.NewInt(0x5001))
			if _, e := rpc.call(local, "zetaphy_faucet", to.Hex()); !strings.Contains(e, "off") || !strings.Contains(e, c.file) {
				t.Errorf("zetaphy_faucet: %q", e)
			}
			if _, e := claim(rpc, to, b.latest, mine(t, b, to, b.latest, 12, 256)); !strings.Contains(e, "off") {
				t.Errorf("zetaphy_faucetPow: %q", e)
			}
			if len(b.sent) != 0 {
				t.Errorf("sent %d", len(b.sent))
			}
		})
	}
	// the bounds themselves are allowed
	b, rpc, home := newPowFaucet(t, "12")
	writeLimit(t, home, faucetAmountFile, "100")
	writeLimit(t, home, faucetPowAmountFile, "0.000000000000000001")
	writeLimit(t, home, faucetDayBudgetFile, "100000")
	if info := powInfo(t, rpc); !info.Enabled || info.FaucetReward.ToInt().Cmp(FaucetMaxAmount) != 0 ||
		info.Reward.ToInt().Cmp(big.NewInt(1)) != 0 || info.DayBudget.ToInt().Cmp(FaucetMaxDayBudget) != 0 {
		t.Errorf("bounds: %+v", info)
	}
	to := common.BigToAddress(big.NewInt(0x5002))
	if _, e := rpc.call(local, "zetaphy_faucet", to.Hex()); e != "" || b.sent[0].Value().Cmp(FaucetMaxAmount) != 0 {
		t.Errorf("100 ZTPHY grant: %q", e)
	}
}

func TestSecurityFaucetLimitsKeyOffSwitch(t *testing.T) {
	// deleting config/faucet.key turns both methods off at once, with no restart; a new key starts its own nonces
	b, rpc, home := newPowFaucet(t, "12")
	a := func(i int) common.Address { return common.BigToAddress(big.NewInt(int64(0x6000 + i))) }
	if _, e := rpc.call(local, "zetaphy_faucet", a(1).Hex()); e != "" {
		t.Fatal(e)
	}
	kf := filepath.Join(home, "config", "faucet.key")
	if err := os.Remove(kf); err != nil {
		t.Fatal(err)
	}
	if info := powInfo(t, rpc); info.Enabled || info.Address != (common.Address{}) {
		t.Errorf("key deleted: %+v", info)
	}
	if _, e := rpc.call(local, "zetaphy_faucet", a(2).Hex()); !strings.Contains(e, "off") {
		t.Errorf("zetaphy_faucet without the key file: %q", e)
	}
	if _, e := claim(rpc, a(3), b.latest, mine(t, b, a(3), b.latest, 12, 256)); !strings.Contains(e, "off") {
		t.Errorf("zetaphy_faucetPow without the key file: %q", e)
	}
	if err := os.WriteFile(kf, []byte("not a key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, e := rpc.call(local, "zetaphy_faucet", a(2).Hex()); !strings.Contains(e, "unreadable") {
		t.Errorf("a bad key file: %q", e)
	}
	key2, _ := crypto.GenerateKey()
	if err := os.WriteFile(kf, []byte(common.Bytes2Hex(crypto.FromECDSA(key2))), 0o600); err != nil {
		t.Fatal(err)
	}
	b.sent = nil // the stand-in counts nonces by transfers sent: none yet for the new key's account
	if _, e := rpc.call(local, "zetaphy_faucet", a(2).Hex()); e != "" {
		t.Fatal(e)
	}
	if info := powInfo(t, rpc); !info.Enabled || info.Address != crypto.PubkeyToAddress(key2.PublicKey) {
		t.Errorf("new key: %+v", info)
	}
	if len(b.sent) != 1 || b.sent[0].Nonce() != 0 {
		t.Fatalf("new key's first transfer: %d sent", len(b.sent))
	}
	signer, err := ethtypes.LatestSignerForChainID(big.NewInt(powTestChainID)).Sender(b.sent[0])
	if err != nil || signer != crypto.PubkeyToAddress(key2.PublicKey) {
		t.Errorf("signed by %s (%v)", signer, err)
	}
}
