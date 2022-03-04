import * as THREE from '//cdn.skypack.dev/three@0.131.1'
import { GUI } from '//cdn.skypack.dev/three@0.131.1/examples/jsm/libs/dat.gui.module.js';
import { OrbitControls } from '//cdn.skypack.dev/three@0.131.1/examples/jsm/controls/OrbitControls.js'
import { RGBELoader } from '//cdn.skypack.dev/three@0.131.1/examples/jsm/loaders/RGBELoader.js'

const backgroundURL = 'https://i.imgur.com/ukoyi9f.png'
const heightMapURL = 'https://upload.wikimedia.org/wikipedia/commons/3/3e/World_Map_Land.png'
const displacementMapURL = new THREE.TextureLoader().load("textures/cloud.png")


createApp({
    params: {
        roughness: 0.1,
        iterations: 64,
        depth: 0.3,
        smoothing: 0.2,
        displacement: 0,
        speed: 0.03,
        colorA: '#0f1328',
        colorB: '#ffe100'
    },
    async init() {
        // Load heightmap and displacement textures
        const heightMap = await this.loadTexture("textures/king.jpg")
        const displacementMap = await this.loadTexture("textures/cloud.png")
        displacementMap.wrapS = displacementMap.wrapT = THREE.RepeatWrapping

        // Prevent seam introduced by THREE.LinearFilter
        heightMap.minFilter = displacementMap.minFilter = THREE.NearestFilter
        heightMap.mapping = THREE.EquirectangularRefractionnMapping

        const geometry = new THREE.SphereGeometry(1, 64, 32)
        const material = new THREE.MeshStandardMaterial({
            roughness: this.params.roughness,
            envMapIntensity: 10,
        })

        // Set up local uniforms object
        this.uniforms = {
            iterations: { value: this.params.iterations },
            depth: { value: this.params.depth },
            smoothing: { value: this.params.smoothing },
            colorA: { value: new THREE.Color(this.params.colorA) },
            colorB: { value: new THREE.Color(this.params.colorB) },
            heightMap: { value: heightMap },
            displacementMap: { value: displacementMap },
            displacement: { value: this.params.displacement },
            time: { value: 0 }
        }

        material.onBeforeCompile = shader => {
            // Wire up local uniform references
            shader.uniforms = { ...shader.uniforms, ...this.uniforms }

            // Add to top of vertex shader
            shader.vertexShader = `
        varying vec3 v_pos;
        varying vec3 v_dir;
      ` + shader.vertexShader

            // Assign values to varyings inside of main()
            shader.vertexShader = shader.vertexShader.replace(/void main\(\) {/, (match) => match + `
        v_dir = position - cameraPosition; // Points from camera to vertex
        v_pos = position;
      `)

            // Add to top of fragment shader
            shader.fragmentShader = `
      #define FLIP vec2(1., -1.)
        
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform sampler2D heightMap;
        uniform sampler2D displacementMap;
        uniform int iterations;
        uniform float depth;
        uniform float smoothing;
        uniform float displacement;
        uniform float time;
        
        varying vec3 v_pos;
        varying vec3 v_dir;
      ` + shader.fragmentShader

            // Add above fragment shader main() so we can access common.glsl.js
            shader.fragmentShader = shader.fragmentShader.replace(/void main\(\) {/, (match) => `
       /**
         * @param p - Point to displace
         * @param strength - How much the map can displace the point
         * @returns Point with scrolling displacement applied
         */
        vec3 displacePoint(vec3 p, float strength) {
        vec2 uv = equirectUv(normalize(p));
          vec2 scroll = vec2(time, 0.);
          vec3 displacementA = texture(displacementMap, uv + scroll).rgb; // Upright
vec3 displacementB = texture(displacementMap, uv * FLIP - scroll).rgb; // Upside down
          
          // Center the range to [-0.5, 0.5], note the range of their sum is [-1, 1]
          displacementA -= 0.5;
          displacementB -= 0.5;
          
          return p + strength * (displacementA + displacementB);
        }
        
/**
          * @param rayOrigin - Point on sphere
          * @param rayDir - Normalized ray direction
          * @returns Diffuse RGB color
          */
        vec3 marchMarble(vec3 rayOrigin, vec3 rayDir) {
          float perIteration = 1. / float(iterations);
          vec3 deltaRay = rayDir * perIteration * depth;

          // Start at point of intersection and accumulate volume
          vec3 p = rayOrigin;
          float totalVolume = 0.;
          int i;

          for (i=0; i<iterations; ++i) {
            // Read heightmap from spherical direction of displaced ray position
            vec3 displaced = displacePoint(p, displacement);
            vec2 uv = equirectUv(normalize(displaced).zyx);
            float heightMapVal = texture(heightMap, uv).r;

            // Take a slice of the heightmap
            float height = length(p); // 1 at surface, 0 at core, assuming radius = 1
            float cutoff = 1. - float(i) * perIteration;
            float slice = smoothstep(cutoff, cutoff + smoothing, heightMapVal);

            // Accumulate the volume and advance the ray forward one step
            totalVolume += slice;
            p += deltaRay;
            
            if (totalVolume >= 1.) break;
          }
          float tint = 1. - float(i) * perIteration;
          return mix(colorA, colorB, tint);
        }
      ` + match)

            shader.fragmentShader = shader.fragmentShader.replace(/vec4 diffuseColor.*;/, `
      vec3 rayDir = normalize(v_dir);
        vec3 rayOrigin = v_pos;
        
        vec3 rgb = marchMarble(rayOrigin, rayDir);
vec4 diffuseColor = vec4(rgb, 1.);      
      `)
        }

        this.mesh = new THREE.Mesh(geometry, material)
        this.scene.add(this.mesh)

        // GUI
        const gui = new GUI()
        gui.add(this.params, 'roughness', 0, 1, 0.01).onChange(v => material.roughness = v)
        gui.add(this.params, 'iterations', 0, 128, 1).onChange(v => this.uniforms.iterations.value = v)
        gui.add(this.params, 'depth', 0, 1, 0.01).onChange(v => this.uniforms.depth.value = v)
        gui.add(this.params, 'smoothing', 0, 1, 0.01).onChange(v => this.uniforms.smoothing.value = v)
        gui.add(this.params, 'displacement', 0, 0.3, 0.001).onChange(v => this.uniforms.displacement.value = v)
        gui.add(this.params, 'speed', 0, 0.1, 0.001)
        gui.addColor(this.params, 'colorA').onChange(v => this.uniforms.colorA.value.set(v))
        gui.addColor(this.params, 'colorB').onChange(v => this.uniforms.colorB.value.set(v))

        // MISC
        await this.setupEnvironment()
        this.setupOrbitControls()
    },
    tick(time, delta) {
        this.controls.update()
        this.uniforms.time.value += delta * this.params.speed
    },
    setupOrbitControls() {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement)
        this.controls.enableDamping = true
        this.controls.autoRotate = true
    },
    async setupEnvironment() {
        const envMap = await this.loadTexture("textures/cloud.png")
        envMap.mapping = THREE.EquirectangularReflectionMapping

        this.scene.environment = this.scene.background = envMap

        const sun = new THREE.DirectionalLight('white', 0.1)
        sun.position.setScalar(3)
        this.scene.add(sun)
        this.scene.add(new THREE.AmbientLight('white', 0.2))
    },
    async loadTexture(url) {
        this.textureLoader = this.textureLoader || new THREE.TextureLoader()
        return new Promise(resolve => {
            this.textureLoader.load(url, texture => {
                resolve(texture)
            })
        })
    }
})






/**
 * Below: boilerplate Three.js app setup and helper functions
 */

function createApp(app) {
    const scene = new THREE.Scene()
    const renderer = createRenderer()
    const camera = createCamera()
    Object.assign(renderer.domElement.style, {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'black'
    })
    document.body.appendChild(renderer.domElement)
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    }, false)
    const clock = new THREE.Clock()
    const loop = () => {
        requestAnimationFrame(loop)
        const delta = clock.getDelta()
        app.tick(clock.elapsedTime, delta)
        renderer.render(scene, camera)
    }
    Object.assign(app, { scene, camera, renderer, clock })
    app.init().then(loop)
}

function createRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.setSize(window.innerWidth, window.innerHeight)
    return renderer
}

function createCamera() {
    const camera = new THREE.PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    )
    camera.position.set(0, 0, 3.5)
    return camera
}
