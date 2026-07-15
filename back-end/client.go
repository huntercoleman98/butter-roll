package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10 // must be less than pongWait
	maxMessageSize = 512 * 1024           // 512 KB
)

// allowedOrigin is set via ALLOWED_ORIGIN env var for dev (e.g. http://localhost:5173).
// Empty in production means same-origin only — the upgrader allows all origins since
// the browser enforces same-origin for same-host requests.
var allowedOrigin = os.Getenv("ALLOWED_ORIGIN")

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		if allowedOrigin == "" {
			return true
		}
		return r.Header.Get("Origin") == allowedOrigin
	},
}

// Client is one connected WebSocket peer.
type Client struct {
	id   string
	hub  *Hub
	conn *websocket.Conn
	send chan []byte // buffered; written by hub, drained by writePump
}


// serveWS upgrades the HTTP connection and starts the client pumps.
func serveWS(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade error: %v", err)
		return
	}
	clientID, err := newUUID()
	if err != nil {
		log.Printf("ws: generate client id: %v", err)
		conn.Close()
		return
	}
	client := &Client{
		id:   clientID,
		hub:  hub,
		conn: conn,
		send: make(chan []byte, 256),
	}
	hub.register <- client

	go client.writePump()
	go client.readPump()
}

// readPump reads messages from the WebSocket and forwards them to hub.broadcast.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
			) {
				log.Printf("ws read error: %v", err)
			}
			break
		}
		c.hub.broadcast <- msg
	}
}

// writePump drains c.send and writes to the WebSocket.
// Also sends periodic pings to keep the connection alive.
// gorilla/websocket requires all writes from a single goroutine.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel.
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Printf("ws write error: %v", err)
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("ws ping error: %v", err)
				return
			}
		}
	}
}
