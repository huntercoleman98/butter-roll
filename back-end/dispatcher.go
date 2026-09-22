package main

import (
	"bytes"
	"log"
	"net/http"
	"time"
)

// dispatcher sends outbound webhook requests off the hub loop. It is the only
// place butter-roll makes an outbound network call. Delivery is fire-and-forget /
// at-most-once: a timeout bounds each send, a full buffer drops the oldest queued
// request, and failures are logged and dropped — a target being down or slow must
// never affect the game.
type dispatcher struct {
	ch     chan outboundRequest
	client *http.Client
}

func newDispatcher() *dispatcher {
	d := &dispatcher{
		ch:     make(chan outboundRequest, 256),
		client: &http.Client{Timeout: 2 * time.Second},
	}
	go d.run()
	return d
}

// enqueue hands a request to the send loop without blocking the hub. If the
// buffer is full (a wedged target), it drops the oldest queued request to make
// room, keeping the most recent — the right bias for state-setting cues.
func (d *dispatcher) enqueue(req outboundRequest) {
	select {
	case d.ch <- req:
		return
	default:
	}
	select {
	case <-d.ch: // discard oldest
	default:
	}
	select {
	case d.ch <- req:
	default: // give up rather than spin
	}
}

func (d *dispatcher) run() {
	for req := range d.ch {
		d.send(req)
	}
}

func (d *dispatcher) send(req outboundRequest) {
	var body *bytes.Reader
	if len(req.Body) > 0 {
		body = bytes.NewReader(req.Body)
	} else {
		body = bytes.NewReader(nil)
	}
	httpReq, err := http.NewRequest(req.Method, req.URL, body)
	if err != nil {
		log.Printf("dispatcher: build %s %s: %v", req.Method, req.URL, err)
		return
	}
	if len(req.Body) > 0 {
		httpReq.Header.Set("Content-Type", "application/json")
	}
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := d.client.Do(httpReq)
	if err != nil {
		log.Printf("dispatcher: send %s %s: %v", req.Method, req.URL, err)
		return
	}
	_ = resp.Body.Close()
}
