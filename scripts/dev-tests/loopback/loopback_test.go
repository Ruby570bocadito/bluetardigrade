package loopback

import "testing"

func TestGeneratedInputsCannotTargetRemoteEngines(t *testing.T) {
	for _, address := range []string{"127.0.0.1:7777", "127.0.0.2:1", "[::1]:65535"} {
		if err := Address(address); err != nil {
			t.Fatalf("local test target %q rejected: %v", address, err)
		}
	}
	for _, address := range []string{"10.0.0.1:7777", "8.8.8.8:443", "0.0.0.0:7777", "[::]:7777", "localhost:7777", "engine.example:7777", "127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1"} {
		if err := Address(address); err == nil {
			t.Fatalf("unsafe test target %q accepted", address)
		}
	}
}
