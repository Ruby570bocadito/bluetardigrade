// Package loopback restricts generated test inputs to local test engines.
package loopback

import (
	"errors"
	"net"
	"strconv"
)

// Address requires a literal loopback IP and a usable TCP port, without DNS.
func Address(address string) error {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("test target must be a loopback IP:port")
	}
	ip := net.ParseIP(host)
	n, err := strconv.ParseUint(port, 10, 16)
	if ip == nil || !ip.IsLoopback() || err != nil || n == 0 {
		return errors.New("generated test inputs may only target a literal loopback IP and valid port")
	}
	return nil
}
