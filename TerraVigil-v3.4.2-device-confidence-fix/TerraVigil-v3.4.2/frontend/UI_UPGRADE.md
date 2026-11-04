> Historical notes from the supplied project. For the current sample startup and changes, see ../README.md and ../PROJECT_REVIEW.md.

# TerraVigil UI Upgrade

The project retains its existing app behavior and receives interface and map-presentation upgrades.

## Included improvements

- Aurora Command visual layer for panels, forms, controls, navigation, dialogs, and interactive states.
- Responsive hover, press, focus, and reduced-motion-aware transitions.
- A real OpenStreetMap Leaflet basemap by default in demo and development modes.
- Configurable local or licensed XYZ-tile fallback for field deployments.

## Validation note

Dependencies are not installed in the packaging environment, so type checking could not run there (`tsc: not found`). Run `npm ci && npm run validate && npm run build:all` after extracting.
