package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/afikrim/waba-api-unofficial/internal/config"
	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // registers the "pgx5" database driver
	_ "github.com/golang-migrate/migrate/v4/source/file"     // registers the file source driver
)

func main() {
	direction := flag.String("direction", "up", "migration direction: up, down, or version")
	steps := flag.Int("steps", 0, "number of steps for up/down (0 means all)")
	flag.Parse()

	if err := run(*direction, *steps); err != nil {
		log.Fatal(err)
	}
}

func run(direction string, steps int) error {
	switch direction {
	case "up", "down", "version":
	default:
		return fmt.Errorf("invalid -direction %q: must be one of up, down, version", direction)
	}

	cfg := config.Load()
	absDir, err := filepath.Abs(cfg.MigrationsDir)
	if err != nil {
		return fmt.Errorf("resolve migrations dir: %w", err)
	}
	fi, err := os.Stat(absDir)
	if err != nil || !fi.IsDir() {
		return fmt.Errorf("migrations directory does not exist: %s", absDir)
	}

	m, err := migrate.New("file://"+absDir, toPgxURL(cfg.SupabaseDSN))
	if err != nil {
		return fmt.Errorf("init migrate: %w", err)
	}
	defer m.Close()

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		if steps > 0 {
			err = m.Steps(-steps)
		} else {
			err = m.Down()
		}
	case "version":
		return printVersion(m)
	}

	if err != nil {
		if errors.Is(err, migrate.ErrNoChange) {
			fmt.Println("no change")
			return nil
		}
		return fmt.Errorf("%s failed: %w", direction, err)
	}

	if err := printVersion(m); err != nil {
		return fmt.Errorf("read version after %s: %w", direction, err)
	}
	return nil
}

func printVersion(m *migrate.Migrate) error {
	version, dirty, err := m.Version()
	if err != nil {
		if errors.Is(err, migrate.ErrNilVersion) {
			fmt.Println("no migrations applied")
			return nil
		}
		return err
	}
	fmt.Printf("version: %d (dirty: %v)\n", version, dirty)
	return nil
}

// toPgxURL rewrites a postgres DSN to the scheme the pgx5 migrate driver expects.
func toPgxURL(dsn string) string {
	for _, prefix := range []string{"postgresql://", "postgres://"} {
		if strings.HasPrefix(dsn, prefix) {
			return "pgx5://" + strings.TrimPrefix(dsn, prefix)
		}
	}
	return dsn
}
