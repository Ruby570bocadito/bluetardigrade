package collector

import (
	"errors"
	"testing"
)

func TestFirstLineDropsUTF8BOMAndRefusesUTF16(t *testing.T) {
	plain := []byte(`{"event_type":"flow"}`)
	if got, err := FirstLine(plain); err != nil || string(got) != string(plain) {
		t.Fatalf("plain line changed: %q %v", got, err)
	}
	withBOM := append([]byte{0xEF, 0xBB, 0xBF}, plain...)
	if got, err := FirstLine(withBOM); err != nil || string(got) != string(plain) {
		t.Fatalf("UTF-8 BOM not dropped: %q %v", got, err)
	}
	for _, bom := range [][]byte{{0xFF, 0xFE}, {0xFE, 0xFF}} {
		if _, err := FirstLine(append(bom, '{', 0)); !errors.Is(err, ErrUTF16Input) {
			t.Fatalf("UTF-16 input %x accepted: %v", bom, err)
		}
	}
}
