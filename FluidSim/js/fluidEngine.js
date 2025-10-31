/**
 * Fluid Simulation Engine
 * Ported from C# FluidController.cs
 * May be using Jos Stam's "Real-Time Fluid Dynamics for Games" algorithm
 * but the original source doesn't mention that
 */

class Vector {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    // Operator overloads
    multiply(scalar) {
        return new Vector(this.x * scalar, this.y * scalar);
    }

    subtract(scalar) {
        return new Vector(this.x - scalar, this.y - scalar);
    }

    add(other) {
        if (typeof other === 'number') {
            return new Vector(this.x + other, this.y + other);
        }
        return new Vector(this.x + other.x, this.y + other.y);
    }

    // Static methods for operator overloading
    static multiply(vector, scalar) {
        return vector.multiply(scalar);
    }

    static subtract(vector, scalar) {
        return vector.subtract(scalar);
    }

    static add(vector, other) {
        return vector.add(other);
    }
}

class FluidSimulation {
    constructor(width = 200, height = 200) {
        this.width = width;
        this.height = height;
        this.cutOff = 30;
        this.heatEffect = 0.001;

        // Initialize simulation arrays
        this.density = this.create2DArray(width, height, 0);
        this.densityLast = this.create2DArray(width, height, 0);
        this.velocity = this.create2DArray(width, height, () => new Vector(0, 0));
        this.velocityLast = this.create2DArray(width, height, () => new Vector(0, 0));
    }

    create2DArray(width, height, initialValue) {
        const array = new Array(width);
        for (let x = 0; x < width; x++) {
            array[x] = new Array(height);
            for (let y = 0; y < height; y++) {
                array[x][y] = typeof initialValue === 'function' ? initialValue() : initialValue;
            }
        }
        return array;
    }

    /**
     * Adds the given density source to the density
     */
    addSource(density, densitySource, dt) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                density[x][y] += densitySource[x][y] * dt;
            }
        }
    }

    addSourceVelocity(velocity, velocity0, dt) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                velocity[x][y] = velocity[x][y].add(velocity0[x][y].multiply(dt));
            }
        }
    }

    /**
     * The basic idea behind our method is to find the densities which when diffused backward
     * in time yield the densities we started with.
     */
    diffuse(density, densityLast, diffusionRate, dt) {
        const a = dt * diffusionRate * this.width;

        // This uses Gauss-Seidel relaxation to solve the linear equation
        // Simple tests show that convergence is virtually guaranteed at k=9 or less
        for (let k = 0; k < 11; k++) {
            for (let x = 0; x < this.width; x++) {
                for (let y = 0; y < this.height; y++) {
                    // Handle boundary cells with special cases
                    let neighbors = 0;
                    let neighborSum = 0;
                    
                    if (x > 0) {
                        neighborSum += density[x - 1][y];
                        neighbors++;
                    }
                    if (x < this.width - 1) {
                        neighborSum += density[x + 1][y];
                        neighbors++;
                    }
                    if (y > 0) {
                        neighborSum += density[x][y - 1];
                        neighbors++;
                    }
                    if (y < this.height - 1) {
                        neighborSum += density[x][y + 1];
                        neighbors++;
                    }
                    
                    if (neighbors > 0) {
                        density[x][y] = (densityLast[x][y] + a * neighborSum) / (1 + a * neighbors);
                    } else {
                        density[x][y] = densityLast[x][y];
                    }
                }
            }
            this.setBoundaryDensity(density);
        }
    }

    /**
     * Forces the density to follow a given velocity field, using a linear backtrace.
     */
    advect(density, densityLast, velocity, dt) {
        const N = this.width;
        const dt0 = dt * N;

        for (let i = 0; i < this.width; i++) {
            for (let j = 0; j < this.height; j++) {
                let x = i - dt0 * velocity[i][j].x;
                let y = j - dt0 * velocity[i][j].y;

                x = Math.max(0.5, x);
                x = Math.min(N + 0.5, x);

                const i0 = Math.floor(x);
                const i1 = i0 + 1;

                y = Math.max(0.5, y);
                y = Math.min(N + 0.5, y);

                const j0 = Math.floor(y);
                const j1 = j0 + 1;

                const s1 = x - i0;
                const s0 = 1 - s1;
                const t1 = y - j0;
                const t0 = 1 - t1;

                // Clamp indices to valid range before interpolation
                const i0_clamped = Math.max(0, Math.min(i0, this.width - 1));
                const i1_clamped = Math.max(0, Math.min(i1, this.width - 1));
                const j0_clamped = Math.max(0, Math.min(j0, this.height - 1));
                const j1_clamped = Math.max(0, Math.min(j1, this.height - 1));

                // Always update density, using clamped indices
                density[i][j] = s0 * (t0 * densityLast[i0_clamped][j0_clamped] + t1 * densityLast[i0_clamped][j1_clamped]) +
                               s1 * (t0 * densityLast[i1_clamped][j0_clamped] + t1 * densityLast[i1_clamped][j1_clamped]);
            }
        }

        this.setBoundaryDensity(density);
    }

    densityStep(density, densityLast, velocity, diffusionRate, dt, doDiffuse, doHeat) {
        const newD = this.create2DArray(this.width, this.height, 0);
        this.copy(density, newD);

        this.addSource(density, densityLast, dt);

        if (doDiffuse) {
            this.swap(density, densityLast);
            this.diffuse(density, densityLast, diffusionRate, dt);
        }

        this.swap(density, densityLast);
        this.advect(density, densityLast, velocity, dt);

        if (doHeat) {
            this.setVelocityFromDensity(density, newD, velocity);
        }

        this.setBoundaryDensity(density);
    }

    setVelocityFromDensity(density, density0, velocity) {
        for (let x = 1; x < this.width - 1; x++) {
            for (let y = 1; y < this.height - 1; y++) {
                const newY = this.heatFunction(density[x][y]);      // positive of NEW density
                const oldY = -this.heatFunction(density0[x][y]);   // negative of OLD density
                velocity[x][y].y += newY + oldY;  // = heat(new) - heat(old), so higher density = upward
            }
        }
    }

    heatFunction(density) {
        if (density === 0) {
            return 0;  // No heat effect for empty space
        }
        return (density - (density / this.cutOff)) * this.heatEffect;
    }

    /**
     * Sets the boundary conditions for the velocity field.
     */
    setBoundaryVelocity(velocity) {
        const N = this.width - 2;

        for (let i = 1; i <= N; i++) {
            velocity[0][i].x = Math.abs(velocity[1][i].x);
            velocity[0][i].y = velocity[1][i].y;
            velocity[N + 1][i].x = -Math.abs(velocity[N][i].x);
            velocity[N + 1][i].y = velocity[N][i].y;
            velocity[i][0].x = velocity[i][1].x;
            velocity[i][0].y = -Math.abs(velocity[i][1].y);
            velocity[i][N + 1].x = velocity[i][N].x;
            velocity[i][N + 1].y = Math.abs(velocity[i][N].y);
        }
    }

    setBoundaryDensity(density) {
        // In the original C# code, this method was mostly empty
        // The boundary conditions for density are handled implicitly
        // by the simulation grid bounds
    }


    diffuseVelocity(velocity, velocity0, viscosity, dt) {
        const a = dt * viscosity * this.width;

        for (let k = 0; k < 11; k++) {
            for (let x = 1; x < this.width - 1; x++) {
                for (let y = 1; y < this.height - 1; y++) {
                    velocity[x][y].x = (velocity0[x][y].x + 
                        a * (velocity[x - 1][y].x + 
                             velocity[x + 1][y].x + 
                             velocity[x][y - 1].x + 
                             velocity[x][y + 1].x)) / (1 + 4 * a);

                    velocity[x][y].y = (velocity0[x][y].y + 
                        a * (velocity[x - 1][y].y + 
                             velocity[x + 1][y].y + 
                             velocity[x][y - 1].y + 
                             velocity[x][y + 1].y)) / (1 + 4 * a);
                }
            }
            this.setBoundaryVelocity(velocity);
        }
    }

    velocityStep(velocity, velocity0, viscosity, dt, diffuseVelocity) {
        this.addSourceVelocity(velocity, velocity0, dt);

        this.swap(velocity, velocity0);

        if (diffuseVelocity) {
            this.diffuseVelocity(velocity, velocity0, viscosity, dt);
        } else {
            this.diffuseVelocity(velocity, velocity0, viscosity, dt / 20);
        }

        this.setBoundaryVelocity(velocity);

        this.project(velocity, velocity0);

        const max = 15;

        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                velocity[x][y].x = Math.min(velocity[x][y].x, max);
                velocity[x][y].y = Math.min(velocity[x][y].y, max);
                velocity[x][y].x = Math.max(velocity[x][y].x, -max);
                velocity[x][y].y = Math.max(velocity[x][y].y, -max);
            }
        }
    }

    project(velocity, velocity0) {
        const h = 1.0 / this.width;

        for (let i = 1; i < this.width - 1; i++) {
            for (let j = 1; j < this.height - 1; j++) {
                velocity0[i][j].y = -0.5 * h * (velocity[i + 1][j].x - velocity[i - 1][j].x + 
                                               velocity[i][j + 1].y - velocity[i][j - 1].y);
                velocity0[i][j].x = 0;
            }
        }

        this.setBoundaryVelocity(velocity0);

        for (let k = 0; k < 20; k++) {
            for (let i = 1; i < this.width - 1; i++) {
                for (let j = 1; j < this.height - 1; j++) {
                    velocity0[i][j].x = (velocity0[i][j].y + 
                                        velocity0[i - 1][j].x + 
                                        velocity0[i + 1][j].x + 
                                        velocity0[i][j - 1].x + 
                                        velocity0[i][j + 1].x) / 4;
                }
            }
            this.setBoundaryVelocity(velocity);
        }

        for (let i = 1; i < this.width - 1; i++) {
            for (let j = 1; j < this.height - 1; j++) {
                velocity[i][j].x -= 0.5 * (velocity0[i + 1][j].x - velocity0[i - 1][j].x) / h;
                velocity[i][j].y -= 0.5 * (velocity0[i][j + 1].y - velocity0[i][j - 1].y) / h;
            }
        }

        this.setBoundaryVelocity(velocity);
    }

    swap(first, second) {
        for (let x = 1; x < this.width - 1; x++) {
            for (let y = 1; y < this.height - 1; y++) {
                const temp = first[x][y];
                first[x][y] = second[x][y];
                second[x][y] = temp;
            }
        }
    }

    copy(source, destination) {
        for (let x = 1; x < this.width - 1; x++) {
            for (let y = 1; y < this.height - 1; y++) {
                destination[x][y] = source[x][y];
            }
        }
    }

    // Helper methods for external access
    getDensity() {
        return this.density;
    }

    getVelocity() {
        return this.velocity;
    }

    setDensity(x, y, value) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.density[x][y] = value;
        }
    }

    addDensity(x, y, value) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.density[x][y] += value;
        }
    }

    setVelocity(x, y, velocity) {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            this.velocity[x][y] = velocity;
        }
    }

    clearVelocity() {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                this.velocity[x][y] = new Vector(0, 0);
            }
        }
    }

    reset() {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                this.density[x][y] = 0;
                this.densityLast[x][y] = 0;
                this.velocity[x][y] = new Vector(0, 0);
                this.velocityLast[x][y] = new Vector(0, 0);
            }
        }
    }
}
