package contracts

import (
	"encoding/json"
	"testing"
	"time"
)

func TestWithSeq(t *testing.T) {
	cases := map[string]string{
		`{"a":1}`:     `{"seq":7,"a":1}`,
		` { "a":1 } `: `{"seq":7,"a":1 }`,
		`{}`:          `{"seq":7}`,
	}
	for in, want := range cases {
		got := string(WithSeq([]byte(in), 7))
		if got != want {
			t.Errorf("WithSeq(%q) = %q, quer %q", in, got, want)
		}
		var v map[string]any
		if err := json.Unmarshal([]byte(got), &v); err != nil || v["seq"].(float64) != 7 {
			t.Errorf("JSON resultante inválido %q: %v", got, err)
		}
	}
}

func TestTimeFormats(t *testing.T) {
	at := time.Date(2026, 11, 11, 13, 2, 5, 120_456_000, time.FixedZone("BRT", -3*3600))
	if got := FormatTime(at); got != "2026-11-11T16:02:05.120Z" {
		t.Fatalf("FormatTime = %s", got)
	}
	if got := FormatMinute(at); got != "2026-11-11T16:02:00Z" {
		t.Fatalf("FormatMinute = %s", got)
	}
	back, err := ParseTime("2026-11-11T16:02:05.120Z")
	if err != nil || !back.Equal(at.Truncate(time.Millisecond)) {
		t.Fatalf("ParseTime = %v (%v)", back, err)
	}
}
