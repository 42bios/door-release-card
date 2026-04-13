# Door Release Card

![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange)

Custom Lovelace card for Home Assistant with:
- slide-to-arm unlock flow
- dedicated `Open door` button
- status + last opening text
- visual editor support
- adaptive layout based on dashboard grid size

## Installation via HACS

1. Open HACS in Home Assistant.
2. Go to `Dashboard`.
3. Open menu (three dots) -> `Custom repositories`.
4. Repository URL: `https://github.com/<your-user>/door-release-card`
5. Category: `Dashboard`
6. Install `Door Release Card`.
7. Add resource in Lovelace if needed:
   - URL: `/hacsfiles/door-release-card/door-release-card.js`
   - Type: `module`

## Manual Installation

1. Copy `door-release-card.js` to `<config>/www/door-release-card.js`.
2. Add Lovelace resource:
   - URL: `/local/door-release-card.js`
   - Type: `module`

## Basic Usage

```yaml
type: custom:door-release-card
contact_entity: binary_sensor.haustuer_kontakt
open_script: script.automatische_turoffnung
arm_timeout: 10
unlock_display_timeout: 5
slider_return_ms: 900
```

## Notes

- The card includes a visual config editor in Home Assistant.
- For testing, `simulation_mode: true` can be enabled.

## License

MIT - see [LICENSE](LICENSE).
