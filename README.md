# Solar System 3D Model

A 3D interactive model of the solar system built with JavaScript, HTML, and WebGL (via Three.js). This application allows users to explore the solar system, navigate the camera, and focus on specific planets.

## Features

- **3D Solar System Model**: Realistic representation of the sun and planets
- **Orbital Mechanics**: Planets rotate around the sun and on their own axes
- **Interactive Camera**: Pan, zoom, and rotate the camera to explore the scene
- **Planet Focus**: Click on any planet to center the camera on it
- **Visual Details**: Planets are sized and colored to resemble their real-world counterparts (simplified for visibility)

## Requirements

- Modern web browser with WebGL support
- No external build tools required (uses CDN for libraries)

## Setup

1. Ensure you have a modern web browser (Chrome, Firefox, Edge, or Safari)
2. Open the `index.html` file in your browser
3. No server setup required - simply open the file directly

## Usage

### Navigation Controls

- **Left Click + Drag**: Rotate the camera around the scene
- **Right Click + Drag**: Pan the camera
- **Scroll Wheel**: Zoom in and out

### Planet Interaction

- **Click on a Planet**: Select a planet to automatically center the camera on it
- The camera will smoothly transition to focus on the selected planet

### Controls

- Use the on-screen UI to select planets
- Click on planets directly in the 3D view to focus

## Project Structure

solar-system/
├── index.html          # Main HTML file
├── css/
│   └── styles.css      # Styles for the UI and planet labels
├── js/
│   ├── main.js         # Core application logic
│   ├── camera.js       # Camera control functionality
│   ├── planets.js      # Planet generation and animation
│   └── controls.js     # User input handling
├── assets/
│   └── textures/       # Planet texture images (optional)
└── README.md           # This file


## Implementation Details

- **Three.js**: Used as the WebGL library for 3D rendering
- **Planet Rendering**: Planets are created as spheres with appropriate textures
- **Orbit Paths**: Visual lines indicate orbital paths
- **Camera System**: Custom camera controls allow for intuitive navigation
- **Selection System**: Raycasting detects when a planet is clicked

## Customization

You can modify the following parameters in `js/main.js`:

- `planetSizes`: Adjust relative sizes of planets
- `orbitDistances`: Change orbital distances
- `rotationSpeeds`: Modify how fast planets rotate and orbit
- `colors`: Customize planet appearance

## Browser Compatibility

Works on all modern browsers supporting WebGL:
- Chrome 90+
- Firefox 88+
- Edge 90+
- Safari 14+

## Troubleshooting

If you experience issues:
- Ensure WebGL is enabled in your browser
- Try updating your graphics drivers
- Check browser console for error messages
- Verify all files are in the correct directory structure

## License

This project is provided as-is for educational purposes.