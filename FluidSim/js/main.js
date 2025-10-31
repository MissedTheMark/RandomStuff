/**
 * Main Application Controller
 * Initializes the fluid simulation and manages the animation loop
 */

class FluidSimulationApp {
    constructor() {
        this.canvas = document.getElementById('fluidCanvas');
        this.fluidSim = null;
        this.renderer = null;
        this.uiController = null;
        
        // Animation loop state
        this.simLoopId = null;
        this.renderLoopId = null;
        this.lastSimTime = 0;
        this.lastRenderTime = 0;
        this.frameCount = 0;
        this.lastFpsTime = 0;
        this.accumulatedTime = 0;
        this.lastShowVelocityVectors = false;
        this.adaptiveQuality = true;
        this.performanceHistory = [];
        this.userOverridePerformance = false;
        this.gridSize = 256; // Default grid size
        
        this.init();
    }

    initializeCanvasSize() {
        // Set canvas size to match container (responsive)
        const container = this.canvas.parentElement;
        const size = container.clientWidth; // Use container width (container has aspect-ratio: 1)
        // Ensure canvas internal size matches display size (avoid CSS scaling artifacts)
        this.canvas.width = size;
        this.canvas.height = size;
    }

    init() {
        try {
            // Set canvas size to match container (avoiding CSS scaling issues)
            this.initializeCanvasSize();
            
            // Initialize fluid simulation with current grid size
            this.fluidSim = new FluidSimulation(this.gridSize, this.gridSize);
            
            // Initialize WebGL renderer
            this.renderer = new FluidRenderer(this.canvas);
            
            // Sync renderer grid size with simulation
            this.renderer.setGridSize(this.gridSize, this.gridSize);
            
            // Initialize UI controller
            this.uiController = new UIController(this.canvas, this.fluidSim, this.renderer);
            
            // Update grid size display
            this.uiController.updateGridSizeDisplay(this.gridSize);
            
            // Set up auto-add fluid behavior (matching original LoadDensity function)
            this.setupAutoAddFluid();
            this.setupPerformanceModeListener();
            
            // Start the animation loop
            this.startAnimationLoop();
            
            console.log('Fluid simulation initialized successfully');
        } catch (error) {
            console.error('Failed to initialize fluid simulation:', error);
            this.showError('Failed to initialize WebGL. Please check your browser compatibility.');
        }
    }

    setupAutoAddFluid() {
        // This replicates the LoadDensity function from Form1.cs
        // Auto-adds fluid at bottom edge in the center
        this.addAutoFluid = () => {
            const width = this.fluidSim.width;
            const height = this.fluidSim.height;
            
            // Always clear densityLast first to prevent runaway when auto-add is disabled
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    this.fluidSim.densityLast[x][y] = 0;
                }
            }
            
            // Only add fluid sources if auto-add is enabled
            if (!this.uiController.shouldAutoAddFluid()) return;
            
            const fluidSize = this.uiController.getFluidSize();
            
            // Add fluid at bottom edge in center only
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    if (y > height - (height / 10) &&
                        x >= (width / 2 - width / 15) && 
                        x <= (width / 2 + width / 15)) {
                        this.fluidSim.densityLast[x][y] = fluidSize;
                    }
                }
            }
        };
        
        // Call initially
        this.addAutoFluid();
    }

    setupPerformanceModeListener() {
        // Listen for manual changes to performance mode
        this.uiController.controls.performanceMode.addEventListener('change', () => {
            this.userOverridePerformance = true;
            console.log('User manually changed performance mode to:', this.uiController.controls.performanceMode.value);
        });
        
        // Listen for changes to adaptive quality setting
        this.uiController.controls.adaptiveQuality.addEventListener('change', () => {
            if (this.uiController.controls.adaptiveQuality.checked) {
                // Reset override when adaptive quality is re-enabled
                this.userOverridePerformance = false;
                this.performanceHistory = []; // Clear history for fresh start
                console.log('Adaptive quality re-enabled, resetting performance override');
            }
        });
        
        // Listen for grid size changes
        if (this.uiController.controls.gridSize) {
            this.uiController.controls.gridSize.addEventListener('change', () => {
                const newSize = parseInt(this.uiController.controls.gridSize.value);
                if (newSize !== this.gridSize) {
                    this.resizeGrid(newSize);
                }
            });
        }
    }

    resizeGrid(newSize) {
        console.log(`Resizing grid from ${this.gridSize}×${this.gridSize} to ${newSize}×${newSize}`);
        
        // Stop simulation
        const wasRunning = this.uiController.isRunning();
        if (wasRunning) {
            this.uiController.toggleSimulation();
        }
        
        // Update grid size
        this.gridSize = newSize;
        
        // Recreate simulation with new size
        this.fluidSim = new FluidSimulation(newSize, newSize);
        
        // Update renderer grid size
        this.renderer.setGridSize(newSize, newSize);
        
        // Store current control values before recreating UI controller
        const currentParams = this.uiController.getSimulationParameters();
        const currentAutoAdd = this.uiController.shouldAutoAddFluid();
        
        // Reinitialize UI controller with new simulation
        this.uiController = new UIController(this.canvas, this.fluidSim, this.renderer);
        
        // Restore control values (except grid size which is already set)
        if (this.uiController.controls.autoAddFluid) {
            this.uiController.controls.autoAddFluid.checked = currentAutoAdd;
        }
        
        // Re-setup auto-add fluid
        this.setupAutoAddFluid();
        this.setupPerformanceModeListener();
        
        // Update grid size display
        this.uiController.updateGridSizeDisplay(newSize);
        
        // Restart simulation if it was running
        if (wasRunning) {
            this.uiController.toggleSimulation();
        }
        
        console.log('Grid resized successfully');
    }

    startAnimationLoop() {
        const animate = (currentTime) => {
            this.update(currentTime);
            this.render();
            this.renderLoopId = requestAnimationFrame(animate);
        };
        
        this.renderLoopId = requestAnimationFrame(animate);
    }

    update(currentTime) {
        // Always update FPS counter
        this.updateFPS(currentTime);
        
        // Initialize lastSimTime if this is the first frame
        if (this.lastSimTime === 0) {
            this.lastSimTime = currentTime;
        }
        
        // Only run simulation if it's running
        if (!this.uiController.isRunning()) {
            // Reset accumulated time when stopped to prevent huge catch-up when restarting
            this.accumulatedTime = 0;
            this.lastSimTime = currentTime;
            return;
        }
        
        const params = this.uiController.getSimulationParameters();
        
        // Use variable timestep with accumulation for smoother simulation
        let deltaTime = currentTime - this.lastSimTime;
        
        // Clamp deltaTime to prevent huge jumps (e.g., when tab becomes active after being inactive)
        // Max 500ms per frame to prevent freezing
        const maxDeltaTime = 500;
        if (deltaTime > maxDeltaTime) {
            deltaTime = maxDeltaTime;
        }
        
        this.lastSimTime = currentTime;
        
        // Accumulate time and run simulation steps
        this.accumulatedTime += deltaTime;
        const targetInterval = params.simInterval;
        
        // Run multiple simulation steps if we're behind
        // Add safety limit to prevent infinite loops (max 10 steps per frame)
        let stepCount = 0;
        const maxStepsPerFrame = 10;
        while (this.accumulatedTime >= targetInterval && stepCount < maxStepsPerFrame) {
            this.updateSimulation(params, targetInterval / 1000); // Convert to seconds
            this.accumulatedTime -= targetInterval;
            stepCount++;
        }
        
        // If we still have accumulated time after max steps, reset it to prevent buildup
        if (this.accumulatedTime >= targetInterval) {
            this.accumulatedTime = targetInterval - 1; // Keep it just below threshold
        }
    }

    updateSimulation(params, dt) {
        // dt is now passed from the animation loop (in seconds)
        
        // Update fluid simulation parameters
        this.fluidSim.cutOff = params.cutOff;
        this.fluidSim.heatEffect = params.heatEffect;
        
        // Call addAutoFluid every simulation step (like LoadDensity in original)
        this.addAutoFluid();
        
        // Run density step
        this.fluidSim.densityStep(
            this.fluidSim.density,
            this.fluidSim.densityLast,
            this.fluidSim.velocity,
            params.diffusionRate,
            dt,
            params.enableDispersion,
            params.enableHeat
        );
        
        // Run velocity step
        this.fluidSim.velocityStep(
            this.fluidSim.velocity,
            this.fluidSim.velocityLast,
            params.viscosity,
            dt,
            params.dynamicVelocity
        );
    }

    render() {
        if (!this.renderer) return;
        
        const params = this.uiController.getSimulationParameters();
        
        // Only update renderer settings if they changed
        if (this.lastShowVelocityVectors !== params.showVelocityVectors) {
            this.renderer.setShowVelocityVectors(params.showVelocityVectors);
            this.lastShowVelocityVectors = params.showVelocityVectors;
        }
        
        // Always render - the simulation state changes even when paused due to diffusion
        this.renderer.render(this.fluidSim.getDensity(), this.fluidSim.getVelocity());
    }

    updateFPS(currentTime) {
        this.frameCount++;
        
        if (currentTime - this.lastFpsTime >= 1000) { // Update FPS every second
            const fps = this.frameCount * 1000 / (currentTime - this.lastFpsTime);
            this.uiController.updateFPS(fps);
            
            // Track performance for adaptive quality
            if (this.uiController.controls.adaptiveQuality.checked && !this.userOverridePerformance) {
                this.performanceHistory.push(fps);
                if (this.performanceHistory.length > 10) {
                    this.performanceHistory.shift(); // Keep only last 10 measurements
                }
                
                // Auto-adjust performance mode if FPS is consistently low
                if (this.performanceHistory.length >= 5) {
                    const avgFps = this.performanceHistory.reduce((a, b) => a + b) / this.performanceHistory.length;
                    if (avgFps < 30 && this.uiController.controls.performanceMode.value !== 'performance') {
                        this.uiController.controls.performanceMode.value = 'performance';
                        console.log('Auto-switched to Performance mode due to low FPS');
                    } else if (avgFps > 55 && this.uiController.controls.performanceMode.value === 'performance') {
                        this.uiController.controls.performanceMode.value = 'balanced';
                        console.log('Auto-switched to Balanced mode due to good FPS');
                    }
                }
            }
            
            this.frameCount = 0;
            this.lastFpsTime = currentTime;
        }
    }

    showError(message) {
        // Create error display
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #ff4444;
            color: white;
            padding: 20px;
            border-radius: 8px;
            font-family: Arial, sans-serif;
            z-index: 1000;
            text-align: center;
        `;
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);
    }

    // Public methods for external control
    start() {
        this.uiController.toggleSimulation();
    }

    stop() {
        if (this.uiController.isRunning()) {
            this.uiController.toggleSimulation();
        }
    }

    reset() {
        this.uiController.resetSimulation();
    }

    destroy() {
        if (this.renderLoopId) {
            cancelAnimationFrame(this.renderLoopId);
        }
        if (this.simLoopId) {
            clearInterval(this.simLoopId);
        }
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.fluidApp = new FluidSimulationApp();
});

// Handle window resize with debouncing for better performance
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (window.fluidApp) {
            window.fluidApp.initializeCanvasSize();
            // Update WebGL viewport
            if (window.fluidApp.renderer) {
                const size = window.fluidApp.canvas.width;
                window.fluidApp.renderer.resize(size, size);
            }
        }
    }, 100); // Debounce resize events
});

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (window.fluidApp) {
        window.fluidApp.destroy();
    }
});
