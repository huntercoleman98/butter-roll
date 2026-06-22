package main

import "log"

// Hub maintains the set of active clients and routes messages.
// All access to Session happens inside Run(), so no mutex is needed.
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte // buffered to decouple read pumps from the hub loop
	register   chan *Client
	unregister chan *Client
	session    *Session
}

func NewHub(session *Session) *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		session:    session,
	}
}

// Run is the hub's event loop. Must run in its own goroutine.
func (h *Hub) Run() {
	for {
		select {

		case c := <-h.register:
			h.clients[c] = true
			snap := h.session.Snapshot()
			if snap != nil {
				select {
				case c.send <- snap:
				default:
					log.Printf("hub: snapshot dropped for slow client on connect")
				}
			}

		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}

		case msg := <-h.broadcast:
			if !h.session.Apply(msg) {
				continue
			}
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow consumer — drop the connection.
					delete(h.clients, c)
					close(c.send)
				}
			}
		}
	}
}
