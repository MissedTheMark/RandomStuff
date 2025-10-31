/**
 * UI Controls and Mouse Interaction
 * Handles all user interface interactions and mouse events
 */

class UIController {
    constructor(canvas, fluidSim, renderer) {
        this.canvas = canvas;
        this.fluidSim = fluidSim;
        this.renderer = renderer;
        
        // Mouse interaction state
        this.isMouseDown = false;
        this.lastMouseX = -1;
        this.lastMouseY = -1;
        this.mouseButton = 0; // 0 = left, 2 = right
        
        // Smooth mouse interaction state
        this.mousePositions = []; // Track recent mouse positions for interpolation
        this.maxMousePositions = 3; // Keep last 3 positions for smoothing
        this.pendingInteractions = []; // Queue of interactions to apply
        this.rafId = null; // Animation frame ID for batching
        
        // UI state
        this.isSimulationRunning = false;
        
        this.initializeControls();
        this.setupMouseEvents();
        this.startInteractionBatching();
        
        // Initialize autoAddFluid from checkbox state (after controls are initialized)
        this.autoAddFluid = this.controls.autoAddFluid ? this.controls.autoAddFluid.checked : false;
    }

    initializeControls() {
        // Get all control elements
        this.controls = {
            diffusionRate: document.getElementById('diffusionRate'),
            viscosity: document.getElementById('viscosity'),
            heatEffect: document.getElementById('heatEffect'),
            cutOff: document.getElementById('cutOff'),
            fluidSize: document.getElementById('fluidSize'),
            mouseVelocity: document.getElementById('mouseVelocity'),
            performanceMode: document.getElementById('performanceMode'),
            adaptiveQuality: document.getElementById('adaptiveQuality'),
            gridSize: document.getElementById('gridSize'),
            enableDispersion: document.getElementById('enableDispersion'),
            enableHeat: document.getElementById('enableHeat'),
            dynamicVelocity: document.getElementById('dynamicVelocity'),
            autoAddFluid: document.getElementById('autoAddFluid'),
            showVelocityVectors: document.getElementById('showVelocityVectors'),
            startStopBtn: document.getElementById('startStopBtn'),
            clearVelocityBtn: document.getElementById('clearVelocityBtn'),
            resetBtn: document.getElementById('resetBtn'),
            simStatus: document.getElementById('simStatus'),
            fpsCounter: document.getElementById('fpsCounter'),
            gridSizeDisplay: document.getElementById('gridSizeDisplay')
        };

        // Set up event listeners
        this.setupControlEvents();
    }

    setupControlEvents() {
        // Button events
        this.controls.startStopBtn.addEventListener('click', () => this.toggleSimulation());
        this.controls.clearVelocityBtn.addEventListener('click', () => this.clearVelocity());
        this.controls.resetBtn.addEventListener('click', () => this.resetSimulation());

        // Checkbox events
        this.controls.autoAddFluid.addEventListener('change', (e) => {
            this.autoAddFluid = e.target.checked;
        });

        this.controls.showVelocityVectors.addEventListener('change', (e) => {
            this.renderer.setShowVelocityVectors(e.target.checked);
        });

        // Parameter change events (these will be handled by the main simulation loop)
        const parameterInputs = [
            'diffusionRate', 'viscosity', 'heatEffect', 'cutOff', 
            'fluidSize', 'mouseVelocity', 'simInterval', 'renderInterval',
            'enableDispersion', 'enableHeat', 'dynamicVelocity'
        ];

        parameterInputs.forEach(param => {
            if (this.controls[param]) {
                this.controls[param].addEventListener('input', () => {
                    this.updateSimulationParameters();
                });
            }
        });

        // Set up tooltips
        this.setupTooltips();
        
        // Set up slider synchronization
        this.setupSliderSync();
    }

    setupMouseEvents() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Prevent right-click menu
    }

    handleMouseDown(e) {
        this.isMouseDown = true;
        this.mouseButton = e.button;
        this.updateMousePosition(e);
    }

    handleMouseMove(e) {
        if (!this.isMouseDown) return;

        const mousePos = this.getMousePosition(e);
        
        // Track mouse positions for interpolation
        this.mousePositions.push({
            x: mousePos.x,
            y: mousePos.y,
            time: performance.now()
        });
        
        // Keep only recent positions
        if (this.mousePositions.length > this.maxMousePositions) {
            this.mousePositions.shift();
        }
        
        // Queue interaction for batching
        this.pendingInteractions.push({
            type: this.mouseButton === 0 ? 'velocity' : 'density',
            x: mousePos.x,
            y: mousePos.y
        });
    }

    handleMouseUp(e) {
        this.isMouseDown = false;
        this.lastMouseX = -1;
        this.lastMouseY = -1;
        this.mousePositions = []; // Clear position history
        this.pendingInteractions = []; // Clear pending interactions
    }
    
    startInteractionBatching() {
        const processInteractions = () => {
            if (this.pendingInteractions.length > 0) {
                // Process all pending interactions
                for (const interaction of this.pendingInteractions) {
                    if (interaction.type === 'velocity') {
                        this.addVelocitySmooth(interaction.x, interaction.y);
                    } else if (interaction.type === 'density') {
                        this.addDensitySmooth(interaction.x, interaction.y);
                    }
                }
                this.pendingInteractions = [];
            }
            
            this.rafId = requestAnimationFrame(processInteractions);
        };
        
        this.rafId = requestAnimationFrame(processInteractions);
    }
    
    // Smoothstep function for better falloff curves
    smoothstep(t) {
        return t * t * (3 - 2 * t);
    }
    
    // Smooth velocity calculation with interpolation
    addVelocitySmooth(x, y) {
        if (this.mousePositions.length < 2) {
            // Not enough history, use simple method
            if (this.lastMouseX !== -1 && x > 0 && x < this.fluidSim.width && y > 0 && y < this.fluidSim.height) {
                const velocityMultiplier = parseFloat(this.controls.mouseVelocity.value);
                const baseVelocity = new Vector(
                    (x - this.lastMouseX) * velocityMultiplier,
                    (y - this.lastMouseY) * velocityMultiplier
                );
                
                this.applyVelocityWithSmoothFalloff(x, y, baseVelocity);
            }
            this.lastMouseX = x;
            this.lastMouseY = y;
            return;
        }
        
        // Interpolate between positions for smoother velocity
        const recent = this.mousePositions;
        const current = recent[recent.length - 1];
        const previous = recent[recent.length - 2];
        
        // Calculate velocity from previous to current position
        const velocityMultiplier = parseFloat(this.controls.mouseVelocity.value);
        let baseVelocity = new Vector(
            (current.x - previous.x) * velocityMultiplier,
            (current.y - previous.y) * velocityMultiplier
        );
        
        // Smooth velocity to prevent spikes from fast movements
        const maxVelocity = 5.0; // Maximum velocity per frame
        const velMagnitude = Math.sqrt(baseVelocity.x * baseVelocity.x + baseVelocity.y * baseVelocity.y);
        if (velMagnitude > maxVelocity) {
            const scale = maxVelocity / velMagnitude;
            baseVelocity = baseVelocity.multiply(scale);
        }
        
        // Apply with interpolation for intermediate positions
        if (recent.length >= 2) {
            // Interpolate between last two positions
            const steps = Math.max(2, Math.ceil(velMagnitude / 2)); // More steps for faster movement
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const smoothT = this.smoothstep(t); // Use smoothstep for smooth interpolation
                const interpX = previous.x + (current.x - previous.x) * smoothT;
                const interpY = previous.y + (current.y - previous.y) * smoothT;
                
                const clampedX = Math.max(0, Math.min(this.fluidSim.width - 1, Math.floor(interpX)));
                const clampedY = Math.max(0, Math.min(this.fluidSim.height - 1, Math.floor(interpY)));
                
                // Reduce velocity at interpolated points for smoothness
                const interpVelocity = baseVelocity.multiply(1 - t * 0.3); // Fade out along path
                this.applyVelocityWithSmoothFalloff(clampedX, clampedY, interpVelocity);
            }
        } else {
            this.applyVelocityWithSmoothFalloff(x, y, baseVelocity);
        }
        
        this.lastMouseX = x;
        this.lastMouseY = y;
    }
    
    applyVelocityWithSmoothFalloff(x, y, velocity) {
        // Affect a larger area with smoothstep falloff
        const radius = 3;
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= radius) {
                    const fx = x + dx;
                    const fy = y + dy;
                    if (fx > 0 && fx < this.fluidSim.width && fy > 0 && fy < this.fluidSim.height) {
                        // Use smoothstep for smoother falloff curve
                        const normalizedDist = dist / radius;
                        const falloff = 1.0 - this.smoothstep(normalizedDist);
                        const vel = velocity.multiply(falloff);
                        this.fluidSim.setVelocity(fx, fy, vel);
                    }
                }
            }
        }
    }

    getMousePosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Use the actual canvas internal dimensions for consistent coordinate mapping
        // This matches how the renderer calculates xstep and ystep
        const scaleX = this.fluidSim.width / this.canvas.width;
        const scaleY = this.fluidSim.height / this.canvas.height;
        
        // Calculate coordinates relative to the canvas
        const canvasX = e.clientX - rect.left;
        const canvasY = e.clientY - rect.top;
        
        // Convert to simulation grid coordinates
        let x = Math.floor(canvasX * scaleX);
        let y = Math.floor(canvasY * scaleY);
        
        // Clamp to valid grid bounds
        x = Math.max(0, Math.min(this.fluidSim.width - 1, x));
        y = Math.max(0, Math.min(this.fluidSim.height - 1, y));
        
        return { x, y };
    }

    updateMousePosition(e) {
        const mousePos = this.getMousePosition(e);
        this.lastMouseX = mousePos.x;
        this.lastMouseY = mousePos.y;
    }

    addVelocity(x, y) {
        if (this.lastMouseX !== -1 && x > 0 && x < this.fluidSim.width && y > 0 && y < this.fluidSim.height) {
            const velocityMultiplier = parseFloat(this.controls.mouseVelocity.value);
            const baseVelocity = new Vector(
                (x - this.lastMouseX) * velocityMultiplier,
                (y - this.lastMouseY) * velocityMultiplier
            );
            
            // Affect a larger area with falloff
            const radius = 3;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        const fx = x + dx;
                        const fy = y + dy;
                        if (fx > 0 && fx < this.fluidSim.width && fy > 0 && fy < this.fluidSim.height) {
                            // Falloff based on distance (1.0 at center, 0.0 at edge)
                            const falloff = 1.0 - (dist / radius);
                            const vel = baseVelocity.multiply(falloff);
                            this.fluidSim.setVelocity(fx, fy, vel);
                        }
                    }
                }
            }
        }
    }

    addDensity(x, y) {
        if (x < this.fluidSim.width - 2 && y < this.fluidSim.height - 2 && x > 1 && y > 1) {
            const baseDensity = 100; // Increased from 50 for better visibility
            
            // Add density in a larger area with smoothstep falloff
            const radius = 4;
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= radius) {
                        const fx = x + dx;
                        const fy = y + dy;
                        if (fx > 1 && fx < this.fluidSim.width - 2 && fy > 1 && fy < this.fluidSim.height - 2) {
                            // Use smoothstep for smoother falloff curve
                            const normalizedDist = dist / radius;
                            const falloff = 1.0 - this.smoothstep(normalizedDist);
                            const density = baseDensity * falloff;
                            this.fluidSim.addDensity(fx, fy, density);
                        }
                    }
                }
            }
        }
    }
    
    addDensitySmooth(x, y) {
        if (this.mousePositions.length < 2) {
            // Not enough history, use simple method
            this.addDensity(x, y);
            this.lastMouseX = x;
            this.lastMouseY = y;
            return;
        }
        
        // Interpolate between positions for smoother density addition
        const recent = this.mousePositions;
        const current = recent[recent.length - 1];
        const previous = recent[recent.length - 2];
        
        // Calculate distance for interpolation steps
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Apply with interpolation for intermediate positions
        if (dist > 1 && recent.length >= 2) {
            // Interpolate between last two positions
            const steps = Math.max(2, Math.ceil(dist / 2)); // More steps for larger movements
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const smoothT = this.smoothstep(t); // Use smoothstep for smooth interpolation
                const interpX = previous.x + (current.x - previous.x) * smoothT;
                const interpY = previous.y + (current.y - previous.y) * smoothT;
                
                const clampedX = Math.max(1, Math.min(this.fluidSim.width - 2, Math.floor(interpX)));
                const clampedY = Math.max(1, Math.min(this.fluidSim.height - 2, Math.floor(interpY)));
                
                // Reduce density at interpolated points for smoothness
                const densityMultiplier = 1 - t * 0.2; // Fade out slightly along path
                const baseDensity = 100 * densityMultiplier;
                
                // Add density with smooth falloff
                const radius = 4;
                for (let dx2 = -radius; dx2 <= radius; dx2++) {
                    for (let dy2 = -radius; dy2 <= radius; dy2++) {
                        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                        if (dist2 <= radius) {
                            const fx = clampedX + dx2;
                            const fy = clampedY + dy2;
                            if (fx > 1 && fx < this.fluidSim.width - 2 && fy > 1 && fy < this.fluidSim.height - 2) {
                                const normalizedDist = dist2 / radius;
                                const falloff = 1.0 - this.smoothstep(normalizedDist);
                                const density = baseDensity * falloff;
                                this.fluidSim.addDensity(fx, fy, density);
                            }
                        }
                    }
                }
            }
        } else {
            this.addDensity(x, y);
        }
        
        this.lastMouseX = x;
        this.lastMouseY = y;
    }

    toggleSimulation() {
        this.isSimulationRunning = !this.isSimulationRunning;
        this.controls.startStopBtn.textContent = this.isSimulationRunning ? 'Stop Simulation' : 'Start Simulation';
        this.controls.simStatus.textContent = this.isSimulationRunning ? 'Running' : 'Stopped';
    }

    clearVelocity() {
        this.fluidSim.clearVelocity();
    }

    resetSimulation() {
        this.fluidSim.reset();
        this.isSimulationRunning = false;
        this.controls.startStopBtn.textContent = 'Start Simulation';
        this.controls.simStatus.textContent = 'Stopped';
    }

    updateSimulationParameters() {
        // Update fluid simulation parameters
        this.fluidSim.cutOff = parseInt(this.controls.cutOff.value);
        this.fluidSim.heatEffect = parseFloat(this.controls.heatEffect.value) / 5000; // Match original scaling
    }

    getSimulationParameters() {
        // Get performance mode interval
        const performanceIntervals = {
            'high': 30,
            'balanced': 50,
            'performance': 100
        };
        
        return {
            diffusionRate: parseFloat(this.controls.diffusionRate.value) / 80, // Match original scaling
            viscosity: parseFloat(this.controls.viscosity.value) / 20, // Match original scaling
            heatEffect: parseFloat(this.controls.heatEffect.value) / 5000,
            cutOff: parseInt(this.controls.cutOff.value),
            fluidSize: parseFloat(this.controls.fluidSize.value),
            mouseVelocity: parseFloat(this.controls.mouseVelocity.value),
            simInterval: performanceIntervals[this.controls.performanceMode.value],
            enableDispersion: this.controls.enableDispersion.checked,
            enableHeat: this.controls.enableHeat.checked,
            dynamicVelocity: this.controls.dynamicVelocity.checked,
            autoAddFluid: this.controls.autoAddFluid.checked,
            showVelocityVectors: this.controls.showVelocityVectors.checked
        };
    }

    updateFPS(fps) {
        this.controls.fpsCounter.textContent = Math.round(fps);
    }

    updateGridSizeDisplay(size) {
        if (this.controls.gridSizeDisplay) {
            this.controls.gridSizeDisplay.textContent = `${size}×${size}`;
        }
    }

    isRunning() {
        return this.isSimulationRunning;
    }

    shouldAutoAddFluid() {
        return this.autoAddFluid;
    }

    getFluidSize() {
        return parseFloat(this.controls.fluidSize.value);
    }

    setupTooltips() {
        const helpIcons = document.querySelectorAll('.help-icon');
        helpIcons.forEach(icon => {
            const tooltipText = icon.getAttribute('data-tooltip');
            if (tooltipText) {
                // Create tooltip element
                const tooltip = document.createElement('div');
                tooltip.className = 'tooltip';
                tooltip.textContent = tooltipText;
                icon.appendChild(tooltip);
            }
        });
    }

    setupSliderSync() {
        // Define slider pairs
        const sliderPairs = [
            { slider: 'diffusionRateSlider', input: 'diffusionRate' },
            { slider: 'viscositySlider', input: 'viscosity' },
            { slider: 'heatEffectSlider', input: 'heatEffect' },
            { slider: 'cutOffSlider', input: 'cutOff' },
            { slider: 'fluidSizeSlider', input: 'fluidSize' },
            { slider: 'mouseVelocitySlider', input: 'mouseVelocity' }
        ];

        sliderPairs.forEach(pair => {
            const slider = document.getElementById(pair.slider);
            const input = document.getElementById(pair.input);
            
            if (slider && input) {
                // Sync slider to input
                slider.addEventListener('input', () => {
                    input.value = slider.value;
                    this.updateSimulationParameters();
                });
                
                // Sync input to slider
                input.addEventListener('input', () => {
                    slider.value = input.value;
                    this.updateSimulationParameters();
                });
            }
        });
    }
}
