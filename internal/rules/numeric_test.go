package rules

import "testing"

// gt/lt solo comparan numeros: un campo ausente o no numerico nunca
// cumple la condicion (antes "" < "1024" era cierto y "9" > "10" tambien).
func TestNumericOperatorsNeedNumbers(t *testing.T) {
	cases := []struct {
		op    string
		val   any
		given any
		want  bool
	}{
		{"lt", 1024, nil, false},
		{"gt", 1024, nil, false},
		{"lt", 1024, "", false},
		{"lt", 1024, "abc", false},
		{"gt", 1024, "zzz", false},
		{"gt", "abc", 5, false},
		{"lt", nil, 5, false},
		{"gt", 10, "9", false},
		{"lt", 10, "9", true},
		{"gt", 9, "10", true},
		{"gt", int64(443), float64(8080), true},
		{"lt", uint64(443), float64(80), true},
		{"gt", int64(1) << 40, float64(1 << 41), true},
		{"gt", 443, int64(8080), true},
		{"lt", 443, uint32(80), true},
		{"gt", 443, " 8080 ", true},
		{"gt", 443, "NaN", false},
		{"lt", 443, "NaN", false},
		{"gt", 443, true, false},
	}
	for i, tc := range cases {
		m, err := NewMatcher([]Condition{{Field: "f", Operator: tc.op, Value: tc.val}})
		if err != nil {
			t.Fatalf("case %d: %v", i, err)
		}
		fields := map[string]any{"f": tc.given}
		if tc.given == nil {
			fields = map[string]any{}
		}
		if got := m.MatchFields(fields); got != tc.want {
			t.Errorf("case %d: %s(%v, %v) = %v, want %v", i, tc.op, tc.given, tc.val, got, tc.want)
		}
	}
}
