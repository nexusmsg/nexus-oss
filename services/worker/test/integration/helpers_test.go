//go:build integration

package integration_test

import (
	"bytes"
	"flag"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wiremock/go-wiremock"
	"github.com/wiremock/go-wiremock/journal"
)

// Shared golden-file helpers (integration-test skill convention): reviewed
// expected outputs live under <services/worker>/testdata/golden/; run
// `go test -update` to regenerate and manually review the diff before
// committing. The golden dir is resolved from this package's source location
// (test/integration) because go test runs each test binary with the package
// directory as its working directory.

var update = flag.Bool("update", false, "update golden files")

func goldenPath(name string) string {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return filepath.Join("testdata", "golden", name)
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "testdata", "golden", name)
}

func assertGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := goldenPath(name)

	if *update {
		if err := os.WriteFile(path, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}

	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("golden file %s missing; run `go test -update`", path)
	}
	if !bytes.Equal(want, got) {
		t.Errorf("%s mismatch:\n want: %s\n got:  %s", name, want, got)
	}
}

// wiremockURL returns the WireMock admin base URL, overridable via
// WIREMOCK_URL (default http://localhost:8080).
func wiremockURL() string {
	url := os.Getenv("WIREMOCK_URL")
	if url == "" {
		url = "http://localhost:8080"
	}
	return strings.TrimRight(url, "/")
}

// wiremockSetup connects the go-wiremock client to the running WireMock
// server (the hermetic WireMock suite never skips — the server must be up)
// and registers cleanup so dynamic stubs, scenarios, and the request journal
// never leak between tests. Static mappings in testdata/wiremock/mappings/ are
// loaded by the container at startup.
func wiremockSetup(t *testing.T) *wiremock.Client {
	t.Helper()
	base := wiremockURL()
	wm := wiremock.NewClient(base)
	waitForWiremock(t)
	t.Cleanup(func() { _ = wm.DeleteAllRequests() })
	t.Cleanup(func() { _ = wm.Reset() })
	t.Cleanup(func() { _ = wm.ResetAllScenarios() })
	return wm
}

// waitForWiremock polls the admin health endpoint until the server responds or
// the deadline passes, failing with a start-up hint instead of a cryptic
// connection error.
func waitForWiremock(t *testing.T) {
	t.Helper()
	base := wiremockURL()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(base + "/__admin/health")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("wiremock at %s is not reachable; start it first, e.g.: "+
		"docker run -d --rm --name waba-it-wiremock -p 8080:8080 "+
		"-v \"$(pwd)/testdata/wiremock/mappings:/home/wiremock/mappings\" "+
		"-v \"$(pwd)/testdata/wiremock/__files:/home/wiremock/__files\" wiremock/wiremock",
		base)
}

// captureRequest returns the first journaled request matching criteria, for
// asserting the exact bytes the adapter actually sent on the wire.
func captureRequest(t *testing.T, wm *wiremock.Client, criteria *wiremock.Request) journal.Request {
	t.Helper()
	res, err := wm.FindRequestsByCriteria(criteria)
	if err != nil {
		t.Fatalf("fetch journal requests: %v", err)
	}
	if len(res.Requests) == 0 {
		t.Fatal("no journaled request matched the criteria")
	}
	return res.Requests[0]
}
