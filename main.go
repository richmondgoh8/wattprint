package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"

	"github.com/richmondgoh8/wattprint/internal/app"
	"github.com/richmondgoh8/wattprint/internal/config"
	"github.com/richmondgoh8/wattprint/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	cfg, err := config.New("wattprint")
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	st, err := store.Open(cfg.Path())
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	application := app.New(cfg, st)

	err = wails.Run(&options.App{
		Title:             "Wattprint",
		Width:             1280,
		Height:            800,
		MinWidth:          960,
		MinHeight:         600,
		BackgroundColour:  &options.RGBA{R: 13, G: 17, B: 23, A: 1},
		AssetServer:       &assetserver.Options{Assets: assets},
		OnStartup:         application.Startup,
		OnShutdown:        application.Shutdown,
		Bind:              []interface{}{application},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
	if err != nil {
		log.Fatalf("wails: %v", err)
	}
}
