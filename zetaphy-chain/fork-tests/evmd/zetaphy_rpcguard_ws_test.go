package evmd

// rpc-guard's public CometBFT websocket (evmd/zetaphy_rpcguard_ws.go). The
// node is a stand-in websocket server that records every frame reaching it
// and answers each call (a subscribe also gets an event), so the tests see
// what got through, what the caller was told, and how the connection ended.

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	rpctypes "github.com/cometbft/cometbft/rpc/jsonrpc/types"
	"github.com/gorilla/websocket"
)

type wsNode struct {
	mu     sync.Mutex
	frames []string
}

func (n *wsNode) got() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]string(nil), n.frames...)
}

func (n *wsNode) server(t *testing.T) *httptest.Server {
	up := websocket.Upgrader{}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/websocket" {
			http.NotFound(w, r)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			_, b, err := c.ReadMessage()
			if err != nil {
				return
			}
			n.mu.Lock()
			n.frames = append(n.frames, string(b))
			n.mu.Unlock()
			var call struct {
				Method string          `json:"method"`
				ID     json.RawMessage `json:"id"`
			}
			_ = json.Unmarshal(b, &call)
			_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":`+string(call.ID)+`,"result":{}}`))
			if call.Method == "subscribe" {
				_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":`+string(call.ID)+`,"result":{"query":"tm.event='NewBlock'","data":{"type":"tendermint/event/NewBlock"}}}`))
			}
		}
	}))
	t.Cleanup(s.Close)
	return s
}

// newWSGuard: a guard whose CometBFT backend is a stand-in websocket node,
// served the way rpc-guard serves it (Caddy's connections come from 127.0.0.1).
func newWSGuard(t *testing.T, cfg GuardConfig) (*Guard, *wsNode, string) {
	n := &wsNode{}
	cfg.Comet, cfg.EVM = n.server(t).URL, "http://127.0.0.1:1"
	if cfg.PerMinute == 0 {
		cfg.PerMinute = 1000
	}
	if cfg.MaxInFlight == 0 {
		cfg.MaxInFlight = 8
	}
	g, err := NewGuard(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(g.CometWSHandler())
	t.Cleanup(s.Close)
	return g, n, "ws" + strings.TrimPrefix(s.URL, "http") + "/websocket"
}

func wsDial(t *testing.T, url, ip string) (*websocket.Conn, int) {
	t.Helper()
	h := http.Header{}
	if ip != "" {
		h.Set("X-Forwarded-For", ip)
	}
	c, resp, err := websocket.DefaultDialer.Dial(url, h)
	if err != nil {
		if resp == nil {
			t.Fatalf("dial: %v", err)
		}
		return nil, resp.StatusCode
	}
	t.Cleanup(func() { _ = c.Close() })
	return c, http.StatusSwitchingProtocols
}

func wsRead(t *testing.T, c *websocket.Conn) (string, error) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, b, err := c.ReadMessage()
	return string(b), err
}

// wsClosed: reads until the connection ends and returns its close code (-1: no close frame).
func wsClosed(t *testing.T, c *websocket.Conn) (code int, msgs []string) {
	t.Helper()
	for {
		m, err := wsRead(t, c)
		if err == nil {
			msgs = append(msgs, m)
			continue
		}
		var ce *websocket.CloseError
		if errors.As(err, &ce) {
			return ce.Code, msgs
		}
		return -1, msgs
	}
}

func waitOpen(t *testing.T, g *Guard, want int) {
	t.Helper()
	for i := 0; i < 500 && g.ws.open() != want; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if got := g.ws.open(); got != want {
		t.Fatalf("open websocket connections: %d, want %d", got, want)
	}
}

func TestSecurityRPCGuardWSAllowed(t *testing.T) {
	_, n, url := newWSGuard(t, GuardConfig{FaucetPerDay: 1})
	c, code := wsDial(t, url, "203.0.113.30")
	if c == nil {
		t.Fatalf("handshake: %d", code)
	}
	for i, f := range []string{
		`{"jsonrpc":"2.0","id":1,"method":"status","params":{}}`,
		`{"jsonrpc":"2.0","id":2,"method":"block","params":{"height":"5"}}`,
		` {"jsonrpc":"2.0","id":3,"method":"abci_query","params":{"path":"/x","data":""}}`,
		`{"jsonrpc":"2.0","id":"4","method":"unsubscribe_all","params":{}}`,
	} {
		if err := c.WriteMessage(websocket.TextMessage, []byte(f)); err != nil {
			t.Fatal(err)
		}
		m, err := wsRead(t, c)
		if err != nil || !strings.Contains(m, `"result"`) {
			t.Fatalf("frame %d: %q %v", i, m, err)
		}
	}
	// subscribe: the reply and then the node's events come back
	if err := c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":5,"method":"subscribe","params":{"query":"tm.event='NewBlock'"}}`)); err != nil {
		t.Fatal(err)
	}
	if m, err := wsRead(t, c); err != nil || !strings.Contains(m, `"id":5`) {
		t.Fatalf("subscribe reply: %q %v", m, err)
	}
	if m, err := wsRead(t, c); err != nil || !strings.Contains(m, "tendermint/event/NewBlock") {
		t.Fatalf("event: %q %v", m, err)
	}
	if err := c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":6,"method":"unsubscribe","params":{"query":"tm.event='NewBlock'"}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := wsRead(t, c); err != nil {
		t.Fatal(err)
	}
	if got := len(n.got()); got != 6 {
		t.Errorf("frames at the node: %d, want 6", got)
	}
}

func TestSecurityRPCGuardWSRefused(t *testing.T) {
	g, n, url := newWSGuard(t, GuardConfig{FaucetPerDay: 1})
	cases := []struct {
		frame string
		code  int
	}{
		{`{"jsonrpc":"2.0","id":1,"method":"net_info","params":{}}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"dump_consensus_state"}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"unconfirmed_txs"}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"genesis"}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"unsafe_flush_mempool"}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"status","method":"net_info"}`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"METHOD":"genesis"}`, websocket.ClosePolicyViolation},
		{`{"method":"net_info"}`, websocket.ClosePolicyViolation}, // a notification too
		{`[{"jsonrpc":"2.0","id":1,"method":"status"}]`, websocket.ClosePolicyViolation},
		{`{"jsonrpc":"2.0","id":1,"method":"status"} {"id":2,"method":"net_info"}`, websocket.ClosePolicyViolation},
		{`not json`, websocket.ClosePolicyViolation},
		{``, websocket.ClosePolicyViolation},
	}
	for _, tc := range cases {
		c, code := wsDial(t, url, "203.0.113.31")
		if c == nil {
			t.Fatalf("handshake: %d", code)
		}
		if err := c.WriteMessage(websocket.TextMessage, []byte(tc.frame)); err != nil {
			t.Fatal(err)
		}
		got, msgs := wsClosed(t, c)
		if got != tc.code {
			t.Errorf("%q: close %d, want %d", tc.frame, got, tc.code)
		}
		if len(msgs) != 1 || !strings.Contains(msgs[0], `"error"`) {
			t.Errorf("%q: told %q", tc.frame, msgs)
		}
		_ = c.Close()
		waitOpen(t, g, 0)
	}
	// a disallowed call after allowed ones still closes, and only the allowed ones got through
	c, _ := wsDial(t, url, "203.0.113.31")
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":7,"method":"health"}`))
	if _, err := wsRead(t, c); err != nil {
		t.Fatal(err)
	}
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":8,"method":"net_info"}`))
	if code, msgs := wsClosed(t, c); code != websocket.ClosePolicyViolation || len(msgs) != 1 || !strings.Contains(msgs[0], `"id":8`) {
		t.Errorf("after an allowed call: close %d, %q", code, msgs)
	}
	// binary frames are not JSON-RPC
	c, _ = wsDial(t, url, "203.0.113.31")
	_ = c.WriteMessage(websocket.BinaryMessage, []byte(`{"jsonrpc":"2.0","id":9,"method":"status"}`))
	if code, _ := wsClosed(t, c); code != websocket.CloseUnsupportedData {
		t.Errorf("binary frame: close %d", code)
	}
	for _, f := range n.got() {
		var call wsRPCCall
		if json.Unmarshal([]byte(f), &call) != nil || !cometWSMethodOK(call.Method) {
			t.Errorf("reached the node: %q", f)
		}
	}
	if got := n.got(); len(got) != 1 || !strings.Contains(got[0], `"health"`) {
		t.Errorf("frames at the node: %q", got)
	}
}

func TestSecurityRPCGuardWSLimits(t *testing.T) {
	g, n, url := newWSGuard(t, GuardConfig{FaucetPerDay: 1, WSPerIP: 2, WSMaxConns: 3, WSFrameLimit: 1024})
	a1, _ := wsDial(t, url, "198.51.100.40")
	a2, _ := wsDial(t, url, "198.51.100.40")
	if a1 == nil || a2 == nil {
		t.Fatal("two connections from one IP")
	}
	if c, code := wsDial(t, url, "198.51.100.40"); c != nil || code != http.StatusTooManyRequests {
		t.Errorf("third from one IP: %d", code)
	}
	// a spoofed earlier X-Forwarded-For entry does not help; one IPv6 /64 is one caller
	if c, code := wsDial(t, url, "192.0.2.9, 198.51.100.40"); c != nil || code != http.StatusTooManyRequests {
		t.Errorf("spoofed entry: %d", code)
	}
	b1, _ := wsDial(t, url, "2001:db8:7:8::1")
	if b1 == nil {
		t.Fatal("another IP")
	}
	if c, code := wsDial(t, url, "2001:db8:9::1"); c != nil || code != http.StatusServiceUnavailable {
		t.Errorf("over the total: %d", code)
	}
	_ = a1.Close()
	waitOpen(t, g, 2)
	if c, _ := wsDial(t, url, "198.51.100.40"); c == nil {
		t.Error("a slot freed by a closed connection")
	}

	// a frame over WSFrameLimit closes the connection (1009) and never reaches the node
	before := len(n.got())
	big := `{"jsonrpc":"2.0","id":1,"method":"abci_query","params":{"data":"` + strings.Repeat("A", 2048) + `"}}`
	_ = a2.WriteMessage(websocket.TextMessage, []byte(big))
	if code, _ := wsClosed(t, a2); code != websocket.CloseMessageTooBig {
		t.Errorf("frame over the limit: close %d", code)
	}
	if len(n.got()) != before {
		t.Error("an oversized frame reached the node")
	}

	// limits are checked
	for _, bad := range []GuardConfig{{WSPerIP: -1}, {WSMaxConns: -1}, {WSFrameLimit: -1}, {WSIdle: -time.Second}, {WSFrameLimit: guardBodyLimit + 1}} {
		bad.Comet, bad.EVM, bad.PerMinute, bad.MaxInFlight = "http://127.0.0.1:1", "http://127.0.0.1:2", 1, 1
		if _, err := NewGuard(bad); err == nil {
			t.Errorf("accepted %+v", bad)
		}
	}
	d, err := NewGuard(GuardConfig{Comet: "http://127.0.0.1:26657", EVM: "http://127.0.0.1:8545", PerMinute: 1, MaxInFlight: 1})
	if err != nil {
		t.Fatal(err)
	}
	if d.cfg.WSPerIP != wsDefaultPerIP || d.cfg.WSMaxConns != wsDefaultMaxConns || d.cfg.WSFrameLimit != wsDefaultFrameLimit || d.cfg.WSIdle != wsDefaultIdle {
		t.Errorf("defaults: %+v", d.cfg)
	}
	if u := d.cometWSURL(); u != "ws://127.0.0.1:26657/websocket" {
		t.Errorf("node websocket %q", u)
	}
}

func TestSecurityRPCGuardWSIdleAndRate(t *testing.T) {
	g, _, url := newWSGuard(t, GuardConfig{FaucetPerDay: 1, WSIdle: 300 * time.Millisecond, PerMinute: 3})
	clock := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	g.now = func() time.Time { return clock }
	// idle: nothing either way for WSIdle closes it (1001) and frees the slot
	c, _ := wsDial(t, url, "192.0.2.50")
	start := time.Now()
	if code, _ := wsClosed(t, c); code != websocket.CloseGoingAway {
		t.Errorf("idle: close %d", code)
	}
	if el := time.Since(start); el < 250*time.Millisecond || el > 4*time.Second {
		t.Errorf("idle closed after %v", el)
	}
	waitOpen(t, g, 0)
	// the handshake and every frame count against the per-minute limit (3 here)
	c, _ = wsDial(t, url, "192.0.2.51") // 1
	for i := 0; i < 2; i++ {            // 2, 3
		_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":1,"method":"health"}`))
		if _, err := wsRead(t, c); err != nil {
			t.Fatalf("frame %d: %v", i, err)
		}
	}
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"jsonrpc":"2.0","id":1,"method":"health"}`))
	if code, _ := wsClosed(t, c); code != websocket.ClosePolicyViolation {
		t.Errorf("over the minute limit: close %d", code)
	}
	if c2, code := wsDial(t, url, "192.0.2.51"); c2 != nil || code != http.StatusTooManyRequests {
		t.Errorf("handshake over the minute limit: %d", code)
	}
	clock = clock.Add(time.Minute)
	if c2, _ := wsDial(t, url, "192.0.2.51"); c2 == nil {
		t.Error("next minute")
	}
}

func TestSecurityRPCGuardWSHandshake(t *testing.T) {
	g, _, url := newWSGuard(t, GuardConfig{FaucetPerDay: 1})
	h := g.CometWSHandler()
	if w := do(h, "GET", "/websocket", "", nil); w.Code != http.StatusBadRequest {
		t.Errorf("plain GET: %d", w.Code)
	}
	up := map[string]string{"Upgrade": "websocket", "Connection": "Upgrade", "Sec-Websocket-Version": "13", "Sec-Websocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
	for _, p := range []string{"/", "/status", "/net_info", "/%77ebsocket", "/websocket/../net_info"} {
		if w := do(h, "GET", p, "", up); w.Code != http.StatusForbidden {
			t.Errorf("%s: %d", p, w.Code)
		}
	}
	if w := do(h, "POST", "/websocket", "", up); w.Code != http.StatusBadRequest {
		t.Errorf("POST: %d", w.Code)
	}
	// the HTTP side still refuses websocket upgrades: only this listener serves them
	if w := do(g.CometHandler(), "GET", "/websocket", "", up); w.Code != http.StatusForbidden {
		t.Errorf("HTTP side: %d", w.Code)
	}
	// the node down: refused before the upgrade, and the slot is free again
	down, err := NewGuard(GuardConfig{Comet: "http://127.0.0.1:1", EVM: "http://127.0.0.1:2", PerMinute: 10, MaxInFlight: 1})
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(down.CometWSHandler())
	defer s.Close()
	if c, code := wsDial(t, "ws"+strings.TrimPrefix(s.URL, "http")+"/websocket", ""); c != nil || code != http.StatusBadGateway {
		t.Errorf("node down: %d", code)
	}
	if down.ws.open() != 0 {
		t.Error("slot kept after a failed dial")
	}
	if c, _ := wsDial(t, url, ""); c == nil {
		t.Error("a normal handshake")
	}
	if err := loopbackAddr("0.0.0.0:26668"); err == nil {
		t.Error("public websocket listen address accepted")
	}
}

// Whatever the frame, one the guard lets through carries, as CometBFT's
// websocket decodes it (json.Decoder into RPCRequest), an allowed method or
// is a notification CometBFT does not run.
func FuzzRPCGuardWSFrame(f *testing.F) {
	for _, s := range []string{
		`{"jsonrpc":"2.0","id":1,"method":"status"}`, `{"id":1,"method":"subscribe","params":{"query":"tm.event='Tx'"}}`,
		`{"id":1,"method":"status","method":"net_info"}`, `{"id":1,"Method":"genesis"}`, `[{"id":1,"method":"tx"}]`,
		`{"id":1,"method":"status"} {"id":2,"method":"net_info"}`, ` {"id":"x","method":"unsubscribe_all"}`,
	} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, frame string) {
		m, _, err := wsFrameCall([]byte(frame))
		if err != nil || !cometWSMethodOK(m) {
			return // refused
		}
		var req rpctypes.RPCRequest
		if err := json.NewDecoder(bytes.NewReader([]byte(frame))).Decode(&req); err != nil {
			return // CometBFT refuses it too
		}
		if req.ID == nil {
			return // a notification: CometBFT does not run it
		}
		if !cometWSMethodOK(req.Method) || req.Method != m {
			t.Fatalf("let through %q: guard read %q, CometBFT runs %q", frame, m, req.Method)
		}
	})
}
