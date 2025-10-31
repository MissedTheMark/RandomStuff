/**
 * WebGL Renderer for Fluid Simulation
 * Ported from OpenGL immediate mode rendering in Form1.cs
 */

class FluidRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.vertexBuffer = null;
        this.vertexPositionAttribute = null;
        this.colorUniform = null;
        this.projectionMatrixUniform = null;
        this.modelViewMatrixUniform = null;
        
        this.width = 200;
        this.height = 200;
        this.showVelocityVectors = false;
        
        this.initWebGL();
    }

    initWebGL() {
        // Get WebGL context
        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }

        // Create shaders
        const vertexShaderSource = `
            attribute vec4 aVertexPosition;
            attribute vec2 aTexCoord;
            uniform mat4 uModelViewMatrix;
            uniform mat4 uProjectionMatrix;
            varying vec2 vTexCoord;
            
            void main() {
                gl_Position = uProjectionMatrix * uModelViewMatrix * aVertexPosition;
                vTexCoord = aTexCoord;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            uniform vec4 uColor;
            uniform sampler2D uTexture;
            uniform bool uUseTexture;
            varying vec2 vTexCoord;
            
            void main() {
                if (uUseTexture) {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                } else {
                    gl_FragColor = uColor;
                }
            }
        `;

        // Compile shaders
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);

        // Create program
        this.program = this.createProgram(vertexShader, fragmentShader);

        // Get attribute and uniform locations
        this.vertexPositionAttribute = this.gl.getAttribLocation(this.program, 'aVertexPosition');
        this.texCoordAttribute = this.gl.getAttribLocation(this.program, 'aTexCoord');
        this.colorUniform = this.gl.getUniformLocation(this.program, 'uColor');
        this.textureUniform = this.gl.getUniformLocation(this.program, 'uTexture');
        this.useTextureUniform = this.gl.getUniformLocation(this.program, 'uUseTexture');
        this.projectionMatrixUniform = this.gl.getUniformLocation(this.program, 'uProjectionMatrix');
        this.modelViewMatrixUniform = this.gl.getUniformLocation(this.program, 'uModelViewMatrix');
        
        // Create density texture for smooth color transitions
        this.densityTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.densityTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        // Create vertex buffer for quads
        this.vertexBuffer = this.gl.createBuffer();

        // Set up projection matrix (orthographic, matching original OpenGL setup)
        this.setupProjection();

        // Enable blending for smooth colors
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);

        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking error:', this.gl.getProgramInfoLog(program));
            this.gl.deleteProgram(program);
            return null;
        }

        return program;
    }

    setupProjection() {
        // Set up orthographic projection matching the original OpenGL setup
        // glOrtho(0, width, height, 0, 0, 1)
        const left = 0;
        const right = this.width;
        const bottom = this.height;
        const top = 0;
        const near = 0;
        const far = 1;

        const projectionMatrix = [
            2 / (right - left), 0, 0, 0,
            0, 2 / (top - bottom), 0, 0,
            0, 0, -2 / (far - near), 0,
            -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1
        ];

        this.gl.useProgram(this.program);
        this.gl.uniformMatrix4fv(this.projectionMatrixUniform, false, projectionMatrix);
    }

    render(density, velocity) {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.useProgram(this.program);

        // Use texture-based rendering with linear filtering for smooth color transitions
        this.renderDensityTexture(density);

        // Render velocity vectors if enabled
        if (this.showVelocityVectors) {
            const xstep = this.canvas.width / this.width;
            const ystep = this.canvas.height / this.height;
            this.renderVelocityVectors(velocity, xstep, ystep);
        }
    }

    getDensityColor(density) {
        // Match the original color mapping logic from Form1.cs lines 262-283
        const blah = Math.floor(density * 5);
        
        let r = 0;
        let g = Math.min(255, 0 + blah / 5) / 255;
        let b;

        if (blah > 160) {
            r = Math.min(255, (blah - 160) / 1) / 255;
        }

        if (blah > 255) {
            b = Math.max(0, 255 - (blah - 255)) / 255;
        } else {
            b = Math.min(255, blah) / 255;
        }

        return [r, g, b, 1.0]; // RGBA
    }

    drawQuad(x, y, width, height, color) {
        // Create quad vertices
        const x1 = x;
        const y1 = y;
        const x2 = x + width;
        const y2 = y + height;

        const vertices = [
            x1, y1,     // Top-left
            x2, y1,     // Top-right
            x1, y2,     // Bottom-left
            x2, y2      // Bottom-right
        ];

        // Bind vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);

        // Enable vertex attribute
        this.gl.enableVertexAttribArray(this.vertexPositionAttribute);
        this.gl.vertexAttribPointer(this.vertexPositionAttribute, 2, this.gl.FLOAT, false, 0, 0);

        // Set color
        this.gl.uniform4fv(this.colorUniform, color);

        // Set model-view matrix to identity
        const identityMatrix = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
        this.gl.uniformMatrix4fv(this.modelViewMatrixUniform, false, identityMatrix);

        // Draw quad
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    renderDensityBatched(density) {
        // Calculate scaling factors
        const xstep = this.canvas.width / this.width;
        const ystep = this.canvas.height / this.height;
        
        // Use a hybrid approach: batch only when it makes sense, fall back to individual for complex cases
        const colorGroups = new Map();
        let totalQuads = 0;
        
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const densityValue = density[x][y];
                const color = this.getDensityColor(densityValue);
                
                // Use exact color matching to avoid artifacts
                const colorKey = `${color[0]},${color[1]},${color[2]},${color[3]}`;
                
                if (!colorGroups.has(colorKey)) {
                    colorGroups.set(colorKey, { color: color, quads: [] });
                }
                
                colorGroups.get(colorKey).quads.push({ x, y, xstep, ystep });
                totalQuads++;
            }
        }
        
        // If we have too many different colors, fall back to individual rendering for better accuracy
        if (colorGroups.size > totalQuads * 0.8) {
            this.renderDensityIndividual(density, xstep, ystep);
            return;
        }
        
        // Render each color group as a batch
        for (const [colorKey, group] of colorGroups) {
            this.gl.uniform4fv(this.colorUniform, group.color);
            
            // Create vertices for all quads of this color
            const vertices = [];
            for (const quad of group.quads) {
                const x1 = quad.x;
                const y1 = quad.y;
                const x2 = quad.x + quad.xstep;
                const y2 = quad.y + quad.ystep;
                
                // Add quad vertices as two triangles (6 vertices total per quad)
                vertices.push(
                    x1, y1,     // Triangle 1: Top-left
                    x2, y1,     // Top-right
                    x1, y2,     // Bottom-left
                    x1, y2,     // Triangle 2: Bottom-left
                    x2, y1,     // Top-right
                    x2, y2      // Bottom-right
                );
            }
            
            // Upload all vertices at once
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);
            
            // Set up vertex attribute
            this.gl.enableVertexAttribArray(this.vertexPositionAttribute);
            this.gl.vertexAttribPointer(this.vertexPositionAttribute, 2, this.gl.FLOAT, false, 0, 0);
            
            // Set model-view matrix to identity
            const identityMatrix = [
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1
            ];
            this.gl.uniformMatrix4fv(this.modelViewMatrixUniform, false, identityMatrix);
            
            // Draw all quads of this color as separate triangles
            this.gl.drawArrays(this.gl.TRIANGLES, 0, vertices.length / 2);
        }
    }

    renderDensityIndividual(density, xstep, ystep) {
        // Fallback to individual rendering for complex color patterns
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const densityValue = density[x][y];
                const color = this.getDensityColor(densityValue);
                this.drawQuad(x, y, xstep, ystep, color);
            }
        }
    }

    renderDensityTexture(density) {
        // Convert density field to texture data
        const imageData = new Uint8Array(this.width * this.height * 4);
        
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const densityValue = density[x][y];
                const color = this.getDensityColor(densityValue);
                
                const index = (y * this.width + x) * 4;
                imageData[index] = Math.round(color[0] * 255);     // R
                imageData[index + 1] = Math.round(color[1] * 255); // G
                imageData[index + 2] = Math.round(color[2] * 255); // B
                imageData[index + 3] = Math.round(color[3] * 255); // A
            }
        }
        
        // Upload texture data to GPU
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.densityTexture);
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA,
            this.width,
            this.height,
            0,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            imageData
        );
        
        // Enable texture rendering
        this.gl.uniform1i(this.textureUniform, 0);
        this.gl.uniform1i(this.useTextureUniform, 1);
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.densityTexture);
        
        // Draw full-screen quad with texture
        // Use simulation grid coordinates (matching projection matrix)
        const vertices = [
            // Position (x, y)      Texture coords (u, v)
            0,              0,              0, 0,  // Bottom-left
            this.width,     0,              1, 0,  // Bottom-right
            0,              this.height,    0, 1,  // Top-left
            this.width,     this.height,    1, 1   // Top-right
        ];
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.DYNAMIC_DRAW);
        
        // Set up vertex position attribute
        this.gl.enableVertexAttribArray(this.vertexPositionAttribute);
        this.gl.vertexAttribPointer(this.vertexPositionAttribute, 2, this.gl.FLOAT, false, 16, 0);
        
        // Set up texture coordinate attribute
        this.gl.enableVertexAttribArray(this.texCoordAttribute);
        this.gl.vertexAttribPointer(this.texCoordAttribute, 2, this.gl.FLOAT, false, 16, 8);
        
        // Set model-view matrix to identity
        const identityMatrix = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
        this.gl.uniformMatrix4fv(this.modelViewMatrixUniform, false, identityMatrix);
        
        // Draw quad with texture (smooth interpolation handled by GPU)
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }

    renderVelocityVectors(velocity, xstep, ystep) {
        // Disable texture mode for velocity vectors (use solid color)
        this.gl.uniform1i(this.useTextureUniform, 0);
        
        // Render velocity vectors as red lines (matching original checkBox4 behavior)
        this.gl.uniform4fv(this.colorUniform, [1, 0, 0, 1]); // Red color

        for (let x = 0; x < this.width; x += 4) {
            for (let y = 0; y < this.height; y += 4) {
                const vel = velocity[x][y];
                const velX = vel.x * 20; // Scale factor from original
                const velY = vel.y * 20;

                if (Math.abs(velX) > 0.1 || Math.abs(velY) > 0.1) {
                    // Use grid coordinates directly, matching the density rendering
                    this.drawLine(
                        x, y,
                        x + velX, y + velY
                    );
                }
            }
        }
    }

    drawLine(x1, y1, x2, y2) {
        // Provide vertices as vec4 (x, y, 0, 1) to match shader expectation
        const vertices = [x1, y1, 0, 1, x2, y2, 0, 1];

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.vertexBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(vertices), this.gl.STATIC_DRAW);

        // Disable texture coordinate attribute if it exists (lines don't use textures)
        if (this.texCoordAttribute >= 0) {
            this.gl.disableVertexAttribArray(this.texCoordAttribute);
        }
        
        // Set up vertex position attribute for lines (4 components for vec4)
        this.gl.enableVertexAttribArray(this.vertexPositionAttribute);
        this.gl.vertexAttribPointer(this.vertexPositionAttribute, 4, this.gl.FLOAT, false, 0, 0);

        const identityMatrix = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
        this.gl.uniformMatrix4fv(this.modelViewMatrixUniform, false, identityMatrix);

        this.gl.drawArrays(this.gl.LINES, 0, 2);
    }

    setShowVelocityVectors(show) {
        this.showVelocityVectors = show;
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    setGridSize(width, height) {
        this.width = width;
        this.height = height;
        // Update projection matrix for new grid size
        this.setupProjection();
    }

    clear() {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
}
