/*
 * @author Kirill Edelman
 * @source https://github.com/kirilledelman/pixelbox
 * @documentation https://github.com/kirilledelman/pixelbox/wiki
 * @license MIT
*/

/* scene constructor */
THREE.PixelBoxScene = function () {
	
	THREE.Scene.call( this );

	// setup scene
	this.clearColor = 0x0;
	this.scene = this; // compat. with editor
	
	// add fog
	this.fog = new THREE.Fog( 0x0, 100000, 10000000 );
	
	// add ambient
	this.ambientLight = new THREE.AmbientLight( 0x0 );
	this.add( this.ambientLight );
	
	// flag to call PixelBoxUtil.updateLights
	this.updateLights = true;
	
	// when updating lights, also recompile materials
	this.updateMaterials = true; 
	
	// default camera
	this._camera = new THREE.PerspectiveCamera( 60, renderer.webgl.domElement.width / renderer.webgl.domElement.height, 1, 2000000 );
	this._camera.name = 'camera';
	this._camera.position.set( 70, 70, 70 );
	this._camera.lookAt( 0, 0, 0 );
	this.add( this._camera );

	Object.defineProperty( this, 'camera', {
		get: function () { return this._camera; },
		set: function ( v ) { 
		
			this._camera = v;
			
			this.onCameraChanged( v );
			
		}
	} );	
	
	// create render target / frame buffer
	var renderTargetParameters = { 
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		format: THREE.RGBFormat, 
		stencilBuffer: false 
	};
	
	this.fbo = new THREE.WebGLRenderTarget( renderer.webgl.domElement.width, renderer.webgl.domElement.height, renderTargetParameters );
	
	// create composer for the screen pass, if necessary
	if ( this.screenPass ) {
	
		/* 
			Composer requires the following classes / includes:
			<script src="js/postprocessing/CopyShader.js"></script>
			<script src="js/postprocessing/EffectComposer.js"></script>
			<script src="js/postprocessing/RenderPass.js"></script>
			<script src="js/postprocessing/ShaderPass.js"></script>
			<script src="js/postprocessing/MaskPass.js"></script>
			<script src="js/postprocessing/PixelBoxScreenPass.js"></script>
		*/			
		
		if( !(THREE.EffectComposer && THREE.RenderPass && THREE.CopyShader && THREE.MaskPass && THREE.ShaderPass) ){
		
			throw "Using .screenPass requires the following THREE.js classes: THREE.EffectComposer, THREE.RenderPass, THREE.MaskPass, THREE.ShaderPass, THREE.CopyShader.";
			
		}
	
		// composer
		this.composer =  new THREE.EffectComposer( renderer.webgl, this.fbo );
		
		// render pass
	    this.composer.renderPass = new THREE.RenderPass( this, this.camera );
	    this.composer.addPass( this.composer.renderPass );	    
	    
	    // pass a ShaderPass-like instance to use as final render pass, or pass `true` to use THREE.PixelBoxScreenPass
	    if( typeof(this.screenPass) !== 'object' ) {
	    
		    // PixelBoxScreenPass is an example shader in js/postprocessing/PixelBoxScreenPass.js
		    this.screenPass = new THREE.PixelBoxScreenPass( this );
		
		}
		
		this.composer.addPass( this.screenPass );

	}
	
	// raycaster for mouse picking
	this.raycaster = new THREE.Raycaster( new THREE.Vector3(), new THREE.Vector3(), 0.01, this.camera.far ) ;
	this.floorPlane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 );
	
	// object recycling pool
	this.objectPool = {};
	
	return this;
}

THREE.PixelBoxScene.prototype = Object.create( THREE.Scene.prototype );
THREE.PixelBoxScene.prototype.constructor = THREE.PixelBoxScene;

/* ================================================================================ THREE.PixelBoxRenderer callbacks */
	
/* called by THREE.PixelBoxRenderer after scene transition has finished */
THREE.PixelBoxScene.prototype.onAdded = function () {};

/* 	called by THREE.PixelBoxRenderer before scene transition begins  */	
THREE.PixelBoxScene.prototype.onWillAdd = function () {};

/* 	called by THREE.PixelBoxRenderer after transition has finished */	
THREE.PixelBoxScene.prototype.onWillRemove = function () {};

/* 	called by THREE.PixelBoxRenderer after scene has been removed */
THREE.PixelBoxScene.prototype.onRemoved = function () {};
	
/* ================================================================================ Scene tick */

/* scene think function */
THREE.PixelBoxScene.prototype.tick = function ( delta ) {};

/* ================================================================================ Instantiate a template */

/* 
	instantiate an object as defined in scene template 

		(String) templateName - name of the template from scene definition
		(Object) options - (optional) object to pass to populateObject function (see populateObject function for info)
*/

THREE.PixelBoxScene.prototype.instantiate = function ( templateName, options ) {

	var def = this.templates[ templateName ];
	
	if ( def ) {
	
		options = options ? options : {};
		options.templates = this.templates;
		
		var objs = this.populateObject( null, [ def ], options );
		
		if ( objs.length ) {
		
			var obj = objs[ 0 ];
			this.linkObjects( objs, obj );
			return obj;
			
		}
		
		console.log( "Instantiate " + templateName + " failed" );
		return null;
		
	}
	
	console.log( "Template " + templateName + " not found in scene definiton" );
	
};
	
/* ================================================================================ Object recycling */

/* 	
	recycle(objectOrArray) - removes object(s) from parent, and recycles it
	
	this is the preferred method of removing objects in THREE.PixelBoxScene
	
	recycling dismantles object's hierarchy and stores each object in scene's objectPool ordered
	by object type and asset name.
	
	recycled objects can later be upcycled (retrieved from the pool) by object type (and reinitialized)
	
	if an object's type is not one of these, it will not be stored in the pool after removal from its parent
	
	supported object types are
		PixelBox, DirectionalLight, HemisphereLight, PointLight, SpotLight, Mesh, PerspectiveCamera, OrthographicCamera, Object3D
		(if it was created by populateObject and thus has .isContainer == true)
		Line (for representing paths)

*/

THREE.PixelBoxScene.prototype.recycle = function ( scrap ) {

	// accept object or an array of objects
	if ( !_.isArray( scrap ) ) scrap = [ scrap ];
	
	var objs, obj, containsLights = false;
	for ( var si = 0, sl = scrap.length; si < sl; si++ ) {
	
		var obj = scrap[ si ];
		objs = obj.recursiveRemoveChildren();
		
		if ( obj.parent ) { 
		
			if ( obj[ 'name' ] ) {
			
				if ( obj.anchored && obj.parent.parent && obj.parent.parent[ obj.name ] == obj ) {
				
					delete obj.parent.parent[ obj.name ];
					
				} else if ( obj.parent[ obj.name ] == obj ) {
				
					delete obj.parent[ obj.name ];
					
				}
				
			}
			
			obj.parent.remove( obj );
			
		}
		
		objs.push( obj );
	
		for ( var i = 0, l = objs.length; i < l; i++ ) {
		
			obj = objs[ i ];
			var typeName = null;
			
			if ( obj instanceof THREE.PixelBox ) {
			
				typeName = obj.geometry.data.name;
				
			} else if ( obj instanceof THREE.DirectionalLight ) {
			
				typeName = 'DirectionalLight'; containsLights = true;
				
			} else if ( obj instanceof THREE.HemisphereLight ) {
			
				typeName = 'HemisphereLight'; containsLights = true;
				
			} else if ( obj instanceof THREE.PointLight ) {
			
				typeName = 'PointLight'; containsLights = true;
				
			} else if ( obj instanceof THREE.SpotLight ) {
			
				typeName = 'SpotLight'; containsLights = true;
				
			} else if ( obj instanceof THREE.Mesh ) {
			
				typeName = 'Geometry';
				
			} else if ( obj instanceof THREE.PerspectiveCamera ) {
			
				typeName = 'Camera';
				
			} else if ( obj instanceof THREE.OrthographicCamera ) {
			
				typeName = 'OrthographicCamera';
				
			} else if ( obj instanceof THREE.LinePath ) {
			
				typeName = 'LinePath';
				
			} else if ( obj instanceof THREE.Object3D && obj.isContainer ) {
			
				typeName = 'Object3D';
				
			}
			
			if ( typeName ) {
			
				// store
				if ( !this.objectPool[ typeName ] ) { 
				
					this.objectPool[ typeName ] = [ obj ];
					
				} else {
				
					this.objectPool[ typeName ].push( obj );
					
				}
				
			}
			
		}
		
	}
	
	if ( containsLights ) this.updateLights = true;
	
};

/* 
	retrieves an object of objType from objectPool
	
	used by populateObject function	
*/

THREE.PixelBoxScene.prototype.upcycle = function ( objType ) {

	var obj = null;
	
	if ( this.objectPool[ objType ] && this.objectPool[ objType ].length ) {
	
		obj = this.objectPool[ objType ][ this.objectPool[ objType ].length - 1 ];
		this.objectPool[ objType ].pop();
		
	}
	
	return obj;
	
};

/* ================================================================================ Scene loading / populating */

/* 	
	populateWith(sceneDef [, options]) - populate scene with definition object
	
		(Object) sceneDef - scene definition as generated by PixelBox Scene editor
		
		(Object) options - (optional) object to pass to populateObject function (see populateObject function for info)
	
*/

THREE.PixelBoxScene.prototype.populateWith = function ( sceneDef, options ) {

	if ( !sceneDef ) {
	
		console.log( "PixelBoxScene.populateWith called with sceneDef = ", sceneDef );
		console.log( "Make sure that the name of scene in sceneDef matches the name of the file loaded with PixelBoxAssets.loadAssets(...)\nCurrently loaded assets: ", assets.files );
		return;
		
	}

	function value( obj, name, defaultVal ) { if ( !obj || obj[ name ] === undefined) return defaultVal; return obj[ name ]; }

	// config
	this.clearColor = parseInt( value( sceneDef, 'clearColor', '0' ), 16 );
	
	this.fog.color.set( parseInt( value( sceneDef, 'fogColor', '0' ), 16 ) );
	this.fog.near = value( sceneDef, 'fogNear', 100000 );
	this.fog.far = value( sceneDef, 'fogFar', 10000000 );
	
	this.ambientLight.color.set( parseInt( value( sceneDef, 'ambient', '0' ), 16 ) );
	
	// add assets to cache if needed
	for ( var i in sceneDef.assets ) {
	
		var asset = sceneDef.assets[ i ];
		
		// compressed PixelBox asset
		if ( typeof( asset ) == 'string' ) {
		
			var json = LZString.decompressFromBase64( asset );
			
			if ( !json ) {
			
				console.error( "Failed to LZString decompressFromBase64: ", asset );
				continue;
				
			}
			
			try {
			
				asset = JSON.parse( json );
				
			} catch( e ) {
			
				console.error( "Failed to parse JSON ", e, json );
				
			}
			
		} else {
		
			asset = _deepClone( asset, 100 );
			
		}
		
		// already loaded
		if ( assets.get( asset.name ) ) continue;
		
		// save reference
		asset.includedWithScene = this;
		
		// add asset to cache if needed
		assets.add( asset.name, asset );
		
	}
	
	options = options ? options : {};
	this.templates = options.templates = sceneDef.templates;

	// populate scene
	var addedObjects = this.populateObject( this, sceneDef.layers ? sceneDef.layers : [], options );

	// prepare maxShadows placeholders
	var numShadows = 0;
	for ( var i = 0, l = addedObjects.length; i < l; i++ ) {
	
		var obj = addedObjects[ i ];
		if ( (obj instanceof THREE.DirectionalLight || obj instanceof THREE.SpotLight) && obj.castShadow ) numShadows++;
		
	}
	
	var maxShadows = Math.max( 0, sceneDef.maxShadows - numShadows );
	this.placeHolderLights = [];
	
	var light;
	
	while ( maxShadows ) {
	
		if ( this.placeHolderLights.length ) light = new THREE.SpotLight( 0x0, 1 );
		else light = new THREE.DirectionalLight( 0x0, 1 );
		
		light.castShadow = true;
		light.shadowMapWidth = light.shadowMapHeight = 128;
		this.add( light );
		this.placeHolderLights.push( light );
		maxShadows--;
		
	}
	
	// link up objects targets
	this.linkObjects( addedObjects, this );
	
};

/* 
	
	populateObject(object, layers [, options]) - populates object from layers definition
	
	returns an array of all objects created
	
	parameters:
	
	(Object3D) object - parent to add generated objects to or null
	(Array) layers - definitions of child objects to add
	(Object) options - (optional) object specifying options
		
			(Function) makeObject(objDef) - (optional callback)
				called before every object is created, or upcycled.
				* Return an Object3D to override this object with your own 
					(note that populateObject will still populate/initialize according to the definiton)
				* Return null to let object be created normally (default behavior)
				* Return -1 to skip creating this object altogether

			(Function) initObject(obj3d, objDef) - (optional callback)
				called after an object has been created and initialized with the definition.
				You can do additional initialization for the object in this callback.
			
			(Object) templates - templates used in the scene to create Instances from

		Additional options used by scene editor:
		
			(BOOL) helpers - create THREE.*Helper for lights and camera
			(BOOL) keepSceneCamera - don't override scene's camera with one in sceneDef
			(BOOL) wrapTemplates - wraps instances in Object3D container
			(BOOL) noNameReferences - don't create object[name] references in parent
			(BOOL) skipProps - passes skipProps parameter to linkObjects call to skip def.props parsing 
	
*/

THREE.PixelBoxScene.prototype.populateObject = function ( object, layers, options ) {

	var degToRad = Math.PI / 180;
	var objectsCreated = [];
	options = options ? options : {};
	
	// create layers
	for ( var i = 0; i < layers.length; i++ ) {
	
		var layer = layers[ i ];
		
		// construct object
		var obj3d = null;
		var helper = null;
		
		// try to get an object of the same type from pool
		if ( options.makeObject ) obj3d = options.makeObject( layer );
		if ( obj3d === -1 ) continue;
		if ( !obj3d && layer.asset != 'Instance' ) obj3d = this.upcycle( layer.asset );
		
		// Layer types
		switch( layer.asset ) {
		
		case 'Instance':
		
			if ( !obj3d ) {
			
				// no helpers in instances
				options = _.clone( options );
				options.helpers = false;

				if ( options.templates && options.templates[ layer.template ] ) {
				
					var objs;
					var templateDef = options.templates[ layer.template ];
					
					if ( options.wrapTemplates ) {
					
						obj3d = new THREE.Object3D();
						obj3d.isInstance = true;
						obj3d.isTemplate = false;
						objs = this.populateObject( obj3d, [ templateDef ], options );
						var topmost = objs[ 0 ];
						this.linkObjects( objs, topmost, !!options.skipProps );
						topmost.omit = true;
						topmost.position.set( 0, 0, 0 );
						topmost.rotation.set( 0, 0, 0 );
						topmost.scale.set( 1, 1, 1 );
						topmost.visible = true;							
						objectsCreated = objectsCreated.concat( objs );
						
					} else {
					
						objs = this.populateObject( object, [ templateDef ], options );
						obj3d = objs[ 0 ];
						obj3d.isInstance = true;
						obj3d.isTemplate = false;
						objs.splice( 0, 1 );
						this.linkObjects( objs, obj3d, !!options.skipProps );
						objectsCreated = objectsCreated.concat( objs );
						
					}
					
					// copy some props from template
					obj3d.castShadow = (templateDef.castShadow != undefined ? templateDef.castShadow : true);
					obj3d.receiveShadow = (templateDef.receiveShadow != undefined ? templateDef.receiveShadow : true);
					
				} else {
				
					console.log( "Template " + layer.template + " not found" );
					if ( !obj3d ) obj3d = new THREE.Object3D();
					
				}
				
			}
			
			break;
			
		case 'Camera':
		
			if ( !obj3d ) obj3d = new THREE.PerspectiveCamera( 60, 1, 1, 1000 );
			if ( layer.fov != undefined ) obj3d.fov = layer.fov;
			if ( layer.near != undefined ) obj3d.near = layer.near;
			if ( layer.far != undefined ) obj3d.far = layer.far;
			obj3d.isDefault = layer.isDefault ? true : false;
			
			if ( !options.keepSceneCamera && obj3d.isDefault ) {
			
				if ( this.camera && this.camera.parent ) this.camera.parent.remove( this.camera );
				this.camera = obj3d;
				
			}
			
			if ( options.helpers ) {
			
				helper = new THREE.CameraHelper( obj3d );
				
			}
			
			break;
			
		case 'OrthographicCamera':
		
			var sz = 64;
			if ( options.keepSceneCamera ) { // inside editor
			
				obj3d = new THREE.OrthographicCamera( -sz, sz, sz, -sz, 1, 1000 );
				
			} else {
			
				var w = renderer.webgl.domElement.width * 0.22;
				var h = renderer.webgl.domElement.height * 0.22;
				if ( !obj3d ) obj3d = new THREE.OrthographicCamera( -w, w, h, -h, 1, 1000 );
				
			}
			
			if ( layer.zoom != undefined ) {
			
				obj3d.zoom = layer.zoom;
				obj3d.updateProjectionMatrix();
				
			}
			
			if ( layer.isDefault && (this instanceof THREE.PixelBoxScene) && !this.camera.def ) { 
			
				this.camera.parent.remove( this.camera );
				this.camera = obj3d;
				
			}
			
			obj3d.isDefault = layer.isDefault ? true : false;
			
			if ( !options.keepSceneCamera && obj3d.isDefault ) {
			
				if ( this.camera && this.camera.parent ) this.camera.parent.remove( this.camera );
				this.camera = obj3d;
				
			}
			
			if ( options.helpers ) {
			
				helper = new THREE.CameraHelper( obj3d );
				
			}
			
			break;
			
		case 'DirectionalLight':
		
			if ( !obj3d ) obj3d = new THREE.DirectionalLight( 0xffffff, 1.0 );
		    obj3d.shadowMapWidth = obj3d.shadowMapHeight = 1024;
		    obj3d.shadowCameraNear = (layer.shadowNear != undefined ? layer.shadowNear : 1);
			obj3d.shadowCameraFar = (layer.shadowFar != undefined ? layer.shadowFar : 10000);
			obj3d.shadowCameraRight = (layer.shadowVolumeWidth != undefined ? layer.shadowVolumeWidth : 256) * 0.5;
		    obj3d.shadowCameraLeft = -obj3d.shadowCameraRight;
			obj3d.shadowCameraTop = (layer.shadowVolumeHeight != undefined ? layer.shadowVolumeHeight : (obj3d.shadowCameraRight * 2)) * 0.5;
			obj3d.shadowCameraBottom = -obj3d.shadowCameraTop;
			obj3d.shadowBias = (layer.shadowBias != undefined ? layer.shadowBias : -0.0005);
			if ( obj3d.shadowMap ) {
			
				obj3d.shadowMap.dispose();
				obj3d.shadowMap = null;
				
			}				
			if ( obj3d.shadowCamera ) {
			
				if ( obj3d.shadowCamera.parent ) {
				
					obj3d.shadowCamera.parent.remove( obj3d.shadowCamera );
					
				}
				
				obj3d.shadowCamera = null;
				
			}
			if ( layer.color != undefined ) obj3d.color.set( parseInt( layer.color, 16 ) );
			if ( layer.intensity != undefined ) obj3d.intensity = layer.intensity;
			if ( layer.shadowMapWidth != undefined ) obj3d.shadowMapWidth = obj3d.shadowMapHeight = layer.shadowMapWidth;
			if ( layer.shadowMapHeight != undefined ) obj3d.shadowMapHeight = layer.shadowMapHeight;
			if ( layer.target != undefined && _.isArray( layer.target ) && layer.target.length == 3 ) {// array of world pos
			
				obj3d.target = new THREE.Object3D();
				obj3d.target.position.fromArray( layer.target );
				
			}
			if ( options.helpers ) {
			
		    	helper = new THREE.DirectionalLightHelper( obj3d, 5 );
		    	
		    }
		    
			break;
			
		case 'SpotLight':
		
			if ( !obj3d ) obj3d = new THREE.SpotLight( 0xffffff, 1.0, 100, Math.PI / 3, 70 );
		    obj3d.shadowMapWidth = obj3d.shadowMapHeight = 1024;
		    obj3d.shadowCameraNear = (layer.shadowNear != undefined ? layer.shadowNear : 1);
			obj3d.shadowCameraFar = (layer.shadowFar != undefined ? layer.shadowFar : obj3d.distance);
			obj3d.shadowBias = (layer.shadowBias != undefined ? layer.shadowBias : -0.0005);
			if ( obj3d.shadowMap ) {
			
				obj3d.shadowMap.dispose();
				obj3d.shadowMap = null;
				
			}					
			if ( obj3d.shadowCamera ) {
			
				if ( obj3d.shadowCamera.parent ) {
				
					obj3d.shadowCamera.parent.remove( obj3d.shadowCamera );
					
				}
				
				obj3d.shadowCamera = null;
				
			}
			if ( layer.color != undefined ) obj3d.color.set( parseInt( layer.color, 16 ) );
			if ( layer.intensity != undefined ) obj3d.intensity = layer.intensity;
			if ( layer.distance != undefined ) obj3d.distance = layer.distance;
			if ( layer.exponent != undefined ) obj3d.exponent = layer.exponent;
			if ( layer.angle != undefined ) {
			
				obj3d.angle = layer.angle * degToRad;
				obj3d.shadowCameraFov = layer.angle * 2;
				
			}
			if ( layer.shadowMapWidth != undefined ) obj3d.shadowMapWidth = obj3d.shadowMapHeight = layer.shadowMapWidth;
			if ( layer.shadowMapHeight != undefined ) obj3d.shadowMapHeight = layer.shadowMapHeight;
			if ( layer.target != undefined && _.isArray( layer.target ) && layer.target.length == 3 ) {// array of world pos
			
				obj3d.target = new THREE.Object3D();
				obj3d.target.position.fromArray( layer.target );
				
			}
			
			if ( options.helpers ) { 
			
		    	helper = new THREE.SpotLightHelper( obj3d, 5 );
		    	
		    }
			
			break;
			
		case 'PointLight':
		
			if ( !obj3d ) obj3d = new THREE.PointLight( 0xffffff, 1.0 );
			if ( layer.color != undefined ) obj3d.color.set(parseInt( layer.color, 16 ) );
			if ( layer.intensity != undefined ) obj3d.intensity = layer.intensity;
			if ( layer.distance != undefined ) obj3d.distance = layer.distance;
			if ( options.helpers ) {
			
				helper = new THREE.PointLightHelper( obj3d, 5 );
				
			}
			break;
			
		case 'HemisphereLight':
		
			if ( !obj3d ) obj3d = new THREE.HemisphereLight( 0xffffff, 0x003366, 0.5 );
			
			if ( layer.colors ) { 
			
				obj3d.color.set( parseInt( layer.colors[ 0 ], 16 ) );
				obj3d.groundColor.set( parseInt( layer.colors[ 1 ], 16 ) );
				
			}
				
			if ( layer.intensity != undefined ) obj3d.intensity = layer.intensity;
			
			break;
			
		case 'Object3D':
		
			if ( !obj3d ) obj3d = new THREE.Object3D();
			obj3d.isContainer = true;
			
			break;
			
		case 'LinePath':
		
			if ( !obj3d ) obj3d = new THREE.LinePath();
			obj3d.initialize( layer, options );
				
			break;
			
		case 'Geometry':
		
			var geom = this.makeGeometryObject( layer );
			var mat;
			
			if ( obj3d ) {
			
				obj3d.geometry.dispose();
				obj3d.geometry = geom;
				mat = obj3d.material;
				
				var _gl = renderer.webgl.context;
				for ( var name in geom.attributes ) {
				
					var bufferType = ( name === 'index' ) ? _gl.ELEMENT_ARRAY_BUFFER : _gl.ARRAY_BUFFER;
					var attribute = geom.attributes[ name ];
					if ( !attribute.buffer ) {
					
						attribute.buffer = _gl.createBuffer();
						var res = _gl.bindBuffer( bufferType, attribute.buffer );
						_gl.bufferData( bufferType, attribute.array, _gl.STATIC_DRAW );
						
					}
					
				}
				
			} else {
			
				mat = new THREE.MeshPixelBoxMaterial();
				obj3d = new THREE.Mesh( geom, mat );
				
			}
			
			obj3d.geometryType = layer.mesh;
			
			//material
			mat.tint.set( layer.tint != undefined ? parseInt( layer.tint, 16 ) : 0xffffff );
			mat.addColor.set( layer.addColor != undefined ? parseInt( layer.addColor, 16 ) : 0x0 );
			mat.alpha = (layer.alpha != undefined ? layer.alpha : 1.0);
			mat.brightness = (layer.brightness != undefined ? layer.brightness : 0.0);
			mat.stipple = (layer.stipple != undefined ? layer.stipple : 0.0);
			break;
		
		// lookup asset by name
		default:
			var asset = assets.get( layer.asset );
			if ( asset ) {
			
				if ( !obj3d ) obj3d = new THREE.PixelBox( asset );
				
			} else {
			
				console.log( "Deferred loading of " + layer.asset );
				
				if ( !obj3d ) { 
				
					// asset will be loaded later
					// create placeholder
					obj3d = new THREE.Object3D();
					obj3d.isPlaceholder = true;
					var a = new THREE.AxisHelper( 1 );
					a.isHelper = true;
					obj3d.add( a );
					
				}
				
			}
			
			break;	
			
		}					
		
		// store definition
		obj3d.def = _deepClone( layer, 100 );
		
		// set name
		if ( layer.name ) {
		
			obj3d.name = layer.name;
			
		}
		
		// add as a child
		if ( !obj3d.parent && object ) { 
		
			// add to anchor, if specified
			if ( layer.anchor && object.anchors ) {
			
				object.anchors[ layer.anchor ].add( obj3d );
				
			// otherwise to object itself
			} else {
			
				object.add( obj3d );
				
			}
			
			obj3d.anchored = layer.anchor ? layer.anchor : false;
			
		}			
		
		// assign common values
		if ( layer.position ) {
		
			obj3d.position.fromArray( layer.position );
			
		} else if ( !(obj3d instanceof THREE.HemisphereLight) ) { // damnit!
		
			obj3d.position.set( 0, 0, 0 );
			
		}
		
		if ( layer.rotation ) {
		
			obj3d.rotation.set( layer.rotation[ 0 ] * degToRad, layer.rotation[ 1 ] * degToRad, layer.rotation[ 2 ] * degToRad );
			
		} else {
		
			obj3d.rotation.set( 0, 0, 0 );
			
		}
		if ( layer.scale ) { 
		
			if ( _.isArray( layer.scale ) ) obj3d.scale.fromArray( layer.scale );
			else obj3d.scale.set( layer.scale, layer.scale, layer.scale );
			
		} else {
		
			obj3d.scale.set( 1, 1, 1 );
			
		}
		
		if ( layer.castShadow != undefined ) obj3d.castShadow = layer.castShadow;
		if ( layer.receiveShadow != undefined ) obj3d.receiveShadow = layer.receiveShadow;
		
		if ( helper ) { 
		
			this.scene.add( helper );
			obj3d.helper = helper;
			helper.isHelper = true;
			helper.update();
			helper.visible = false;
			
		}
		
		if ( layer.visible != undefined ) {
		
			obj3d.visible = layer.visible;
			
		} else obj3d.visible = true;
		
		// PixelBox specific
		if ( !obj3d.isInstance && obj3d instanceof THREE.PixelBox ) {
		
			if ( layer.pointSize != undefined ) { 
			
				obj3d.pointSize = layer.pointSize;
				
			}
			
			if ( layer.alpha != undefined ) { 
			
				obj3d.alpha = layer.alpha;
				
			} else {
			
				obj3d.alpha = 1;
				
			}
					
			if ( layer.cullBack != undefined ) obj3d.cullBack = layer.cullBack;
			if ( layer.occlusion != undefined ) obj3d.occlusion = layer.occlusion;
			if ( layer.tint != undefined ) { 
			
				obj3d.tint.set( parseInt( layer.tint, 16 ) );
				
			} else {
			
				obj3d.tint.set( 0xffffff );
				
			}
			if ( layer.add != undefined ) { 
			
				obj3d.addColor.set( parseInt( layer.add, 16 ) );
				
			} else {
			
				obj3d.addColor.set( 0x0 );
				
			}
			if ( layer.stipple != undefined ) { 
			
				obj3d.stipple = layer.stipple;
				
			} else {
			
				obj3d.stipple = 0;
				
			}
			
			if ( layer.animSpeed != undefined ) obj3d.animSpeed = layer.animSpeed;
			
			if ( layer.animName != undefined && obj3d.animNamed( layer.animName ) != undefined ) {
			
				var animOption = layer.animOption ? layer.animOption : 'gotoAndStop';
				var animFrame = layer.animFrame != undefined ? layer.animFrame : 0;
				
				if ( animOption == 'loopAnim' ) {
				
					obj3d.loopAnim( layer.animName, Infinity, false );
					
				} else if ( animOption == 'loopFrom' ) { 
				
					obj3d.gotoAndStop( layer.animName, animFrame + 1 ); 
					obj3d.loopAnim( layer.animName, Infinity, true );
					
				} else if ( animOption == 'playAnim' ) { 
				
					obj3d.playAnim( layer.animName );
					
				} else {
				
					obj3d.gotoAndStop( layer.animName, animFrame );
					
				}
				
			} else if ( layer.animFrame != undefined ) {
			
				obj3d.stopAnim();
				obj3d.frame = layer.animFrame;
				
			}
			
			// re-add anchors if removed
			for ( var a in obj3d.anchors ) {
			
				if ( !obj3d.anchors[a].parent ) {
				
					obj3d.add( obj3d.anchors[ a ] );
					
				}
				
			}
						
		}
		
		// add as a name reference
		if ( layer.name && !options.noNameReferences && object ) {
		
			if ( !object[ layer.name ] ) {
			
				object[ layer.name ] = obj3d;
				
			// if already have one with that name
			} else {
			
				if ( layer.name != 'camera' || (layer.name == 'camera' && !(obj3d instanceof THREE.Camera)) ) { 
				
					console.log( "Warning: ", object, "[" + layer.name + "] already exists. Overwriting." );
					
				}
				
				object[ layer.name ] = obj3d;
			}
			
		}
		
		objectsCreated.splice( 0, 0, obj3d );
		
		if ( !obj3d.isInstance && !obj3d.parentInstance() ) {
					
			if ( layer.isTemplate ) obj3d.isTemplate = layer.isTemplate;
			
			// add templates for editor
			if ( layer.containsTemplates && options.templates ) {
			
				for ( var ti = 0; ti < layer.containsTemplates.length; ti++ ) {
				
					var td = options.templates[ layer.containsTemplates[ ti ] ];
					var addedTemplates = [];
					
					if ( td ) {
					
						var nc = obj3d.children.length;
						addedTemplates = addedTemplates.concat( this.populateObject( obj3d, [ options.templates[ layer.containsTemplates[ ti ] ] ], options ) );
						this.linkObjects( addedTemplates, obj3d.children[ nc ], !!options.skipProps );
						objectsCreated = objectsCreated.concat( addedTemplates );
						
					}
					
				}
				
			}
			
		}
		
		// recursively process children
		if ( layer.layers ) {
		
			objectsCreated = objectsCreated.concat( this.populateObject( obj3d, layer.layers, options ) );
			
		}

		// callback
		if ( options.initObject ) options.initObject( obj3d, layer );
		
	}
	
	return objectsCreated;
	
};

/* generates geometry for 'Geometry' object during populateObject */
THREE.PixelBoxScene.prototype.makeGeometryObject = function ( layer ) {

	function param( p, def, min, max ) { 
	
		var val;
		if ( layer[ p ] !== undefined ) val = layer[ p ]; 
		else val = def; 
		if ( min !== undefined ) val = Math.max( min, val );
		if ( max !== undefined ) val = Math.min( max, val );
		return val;
		
	}
	
	var degToRad = Math.PI / 180;
	var geom;
	
	switch( layer.mesh ) {
	
	case 'Sphere':
	
		layer.radius = param( 'radius', 5 );
		layer.widthSegments = param( 'widthSegments', 8, 3 );
		layer.heightSegments = param( 'heightSegments', 6, 2 );
		layer.phiStart = param( 'phiStart', 0 );
		layer.phiLength = param( 'phiLength', 360 );
		layer.thetaStart = param( 'thetaStart', 0 );
		layer.thetaLength = param( 'thetaLength', 180 );
		geom = new THREE.SphereGeometry(
						layer.radius, 
						layer.widthSegments, layer.heightSegments,
						layer.phiStart * degToRad, layer.phiLength * degToRad,
						layer.thetaStart * degToRad, layer.thetaLength * degToRad );
		break;
		
	case 'Box':
	
		layer.widthSegments = param( 'widthSegments', 1, 1 );
		layer.heightSegments = param( 'heightSegments', 1, 1 );
		layer.depthSegments = param( 'depthSegments', 1, 1 );
		layer.width = param( 'width', 10 );
		layer.height = param( 'height', 10 );
		layer.depth = param( 'depth', 10 );
		geom = new THREE.BoxGeometry( layer.width, layer.height, layer.depth, layer.widthSegments, layer.heightSegments, layer.depthSegments );
		break;

	case 'Plane':
	default:
	
		layer.widthSegments = param( 'widthSegments', 1, 1 );
		layer.heightSegments = param( 'heightSegments', 1, 1 );
		layer.width = param( 'width', 10 );
		layer.height = param( 'height', 10 );
		if ( !layer.inverted )
			geom = new THREE.PlaneBufferGeometry( layer.width, layer.height,layer.widthSegments, layer.heightSegments );
		else
			geom = new THREE.PlaneGeometry( layer.width, layer.height,layer.widthSegments, layer.heightSegments );

		break;
	}
	
	// flip normals
	if ( layer.inverted ) {
	
		for ( var i = 0; i < geom.faces.length; i++ ) {
		
		    var face = geom.faces[ i ];
		    var temp = face.a;
		    face.a = face.c;
		    face.c = temp;
		    
		}
		
		geom.computeFaceNormals();
		geom.computeVertexNormals();
		
		var faceVertexUvs = geom.faceVertexUvs[ 0 ];
		for ( var i = 0; i < faceVertexUvs.length; i ++ ) {
		
		    var temp = faceVertexUvs[ i ][ 0 ];
		    faceVertexUvs[ i ][ 0 ] = faceVertexUvs[ i ][ 2 ];
		    faceVertexUvs[ i ][ 2 ] = temp;
		    
		}
		
	}
	
	return geom;
};

/* 
	links "#targetName.$anchorname.targetName" style references to objects in the hierarchy
	Used by Spot and Direct lights 
*/
THREE.PixelBoxScene.prototype.linkObjects = function ( objs, top, skipProps ) {
	
	function dereferenceObject( nameFragments, currentLevel ) {
	
		// start
		if ( typeof( nameFragments ) == 'string' ) {
		
			nameFragments = nameFragments.split( '.' );
			if ( !nameFragments.length ) return top;
			return dereferenceObject( nameFragments, currentLevel );
			
		// descend
		} else if ( nameFragments.length ) {
		
			var first = nameFragments[ 0 ];
			nameFragments.splice( 0, 1 );
			var obj = null;
			
			if ( first.substr( 0, 1 ) == '$' ) { 
			
				if ( currentLevel.anchors ) obj = currentLevel.anchors[ first.substr( 1 ) ];
				else first = first.substr( 1 );
				
			}
			
			if ( !obj ) {
			
				for ( var ci = 0, cl = currentLevel.children.length; ci < cl; ci++ ) {
				
					if ( currentLevel.children[ ci ].name == first ) {
					
						obj = currentLevel.children[ ci ];
						break;
						
					}
					
				}
				
			}
			
			if ( !obj ) return null;
			if ( nameFragments.length ) return dereferenceObject( nameFragments, obj );
			return obj;
			
		}
		
		return null;
		
	}
	
	// link
	for ( var i = 0, l = objs.length; i < l; i++ ) {
	
		var obj = objs[ i ];
		
		// do .target prop first (for lights)
		var propVal;
		var found;
		var nearestTemplate = undefined;
		this.updateMaterials = this.updateLights = this.updateLights || (obj instanceof THREE.Light);
		
		if ( obj instanceof THREE.SpotLight || obj instanceof THREE.DirectionalLight ) {
		
			propVal = obj.def.target;
			if ( typeof( propVal ) == 'string' && propVal.substr( 0, 1 ) == '#' ) {
			
				nearestTemplate = obj.nearestTemplate();
				found = dereferenceObject( propVal.substr( 1 ), nearestTemplate ? nearestTemplate : top );
				
				if ( found ) { 
				
					obj.target = found;
					obj.def.target = true;
					
				}
				
			}
			
		}
		
		if ( obj.def.props && !skipProps ) {
		
			for ( var propName in obj.def.props ) {
			
				propVal = obj.def.props[ propName ];
				
				if ( typeof( propVal ) == 'string' && propVal.substr( 0, 1 ) == '#' ) {
				
					if ( nearestTemplate === undefined ) nearestTemplate = obj.nearestTemplate();
					found = dereferenceObject( propVal.substr( 1 ), nearestTemplate ? nearestTemplate : top);
					if ( found ) obj[ propName ] = found;
					
				} else {
				
					obj[ propName ] = propVal;
					
				}
				
			}
			
		}
		
	}
	
};

/* ================================================================================ Scene unloading */

/* 
	Prepares the scene to be garbage collected.
	
	Clears object recycle pool and unloads assets that were loaded with the scene definition.
	
	Assets that persist between scenes should be loaded with assets.loadAssets,
	and assets that only exist in a scene as part of scene definition should be part of sceneDef
	
*/	
	
THREE.PixelBoxScene.prototype.dispose = function ( unloadAssets ) {

	// remove all children
	this.recycle( this.children.concat() );
	
	// clear object pool
	for ( var otype in this.objectPool ) {
	
		var objects = this.objectPool[ otype ];
		
		for ( var i = 0, l = objects.length; i < l; i++ ) {
		
			var obj = objects[ i ];
			if ( obj[ 'dispose' ] ) obj.dispose();
			
		}
		
		delete this.objectPool[ otype ];
		
	}
	
	if ( unloadAssets) {
	
		// clean up assets that were loaded with this scene
		for ( var aname in assets.files ) {
			var asset = assets.files[ aname ];
			
			if ( asset.frameData && asset.includedWithScene == this ) {
			
				THREE.PixelBoxUtil.dispose( asset );
				delete assets.files[ aname ];
				
			}
			
		}
		
	}
	
};

/* ================================================================================ THREE.PixelBoxRenderer callbacks */

/* render callback */
THREE.PixelBoxScene.prototype.render = function ( delta, rtt ) {

	this.tick( delta );
	
	// remove maxShadows placeholders
	if ( this.placeHolderLights ) {
	
		for ( var i = 0; i < this.placeHolderLights.length; i++ ) {
		
			this.remove(this.placeHolderLights[i]);
			
		}
		
		this.recycle( this.placeHolderLights );
		this.placeHolderLights = null;
		this.updateLights = true;
		
	}
	
	if ( this.updateLights || this.updateMaterials ) {
	
		THREE.PixelBoxUtil.updateLights( this, this.updateMaterials );
		this.updateLights = false;
		this.updateMaterials = false;
		
	}
	
	renderer.webgl.setClearColor( this.clearColor, 1 );
	
	if ( this.screenPass ) {
	
		this.screenPass.renderToScreen = !rtt;
		this.composer.render( delta );
		
	} else {
	
		if ( rtt ) renderer.webgl.render( this, this.camera, this.fbo, true );
		else renderer.webgl.render( this, this.camera );
		
	}
	
};

/* 
	called whenever scene.camera = newCamera is invoked
 	allows updating screenPass and renderPass's camera property	
*/
THREE.PixelBoxScene.prototype.onCameraChanged = function ( newCamera ) {

	// switch camera in renderPass of composer
	if ( this.screenPass && this.composer && this.composer.renderPass ) {
	
		this.composer.renderPass.camera = newCamera;
		
	}

};

/* resize callback */
THREE.PixelBoxScene.prototype.onResized = function ( resizeFBO ) {

	this.camera.aspect = renderer.webgl.domElement.width / renderer.webgl.domElement.height;
	this.camera.updateProjectionMatrix();
	
	if ( resizeFBO ) {
	
		var renderTargetParameters = { 
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBFormat, 
			stencilBuffer: false 
		};
		
		this.fbo.dispose();
		
		this.fbo = new THREE.WebGLRenderTarget( renderer.webgl.domElement.width, renderer.webgl.domElement.height, renderTargetParameters );
		
		if ( this.screenPass ) {
		
			this.screenPass.onResized();
			
			this.composer.renderTarget2.dispose();
			this.composer.reset( this.fbo );
			
		}
	
	}
	
};