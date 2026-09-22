package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestDispatcherSends(t *testing.T) {
	type received struct {
		method, ctype, xtest, body string
	}
	got := make(chan received, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got <- received{
			method: r.Method,
			ctype:  r.Header.Get("Content-Type"),
			xtest:  r.Header.Get("X-Test"),
			body:   string(b),
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()

	d := newDispatcher()
	d.enqueue(outboundRequest{
		Method:  "POST",
		URL:     srv.URL,
		Headers: map[string]string{"X-Test": "1"},
		Body:    []byte(`{"cue":"x"}`),
	})

	select {
	case r := <-got:
		if r.method != "POST" {
			t.Errorf("method = %q, want POST", r.method)
		}
		if r.ctype != "application/json" {
			t.Errorf("content-type = %q, want application/json", r.ctype)
		}
		if r.xtest != "1" {
			t.Errorf("X-Test = %q, want 1 (config header)", r.xtest)
		}
		if r.body != `{"cue":"x"}` {
			t.Errorf("body = %q, want the rendered payload", r.body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("dispatcher did not deliver the request")
	}
}

// TestDispatcherSurvivesBadTarget proves a failing send is swallowed (no panic,
// no block) so a down target never affects the game.
func TestDispatcherSurvivesBadTarget(t *testing.T) {
	d := newDispatcher()
	// Nothing is listening here; the send must fail quietly.
	d.enqueue(outboundRequest{Method: "POST", URL: "http://127.0.0.1:0/nope", Body: []byte(`{}`)})
	// A well-formed request afterwards still works, proving the loop kept running.
	got := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		got <- struct{}{}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	d.enqueue(outboundRequest{Method: "POST", URL: srv.URL})
	select {
	case <-got:
	case <-time.After(2 * time.Second):
		t.Fatal("dispatcher stopped after a failed send")
	}
}
