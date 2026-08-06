/* ============================================================================
 * SilverMach — car3d.js
 * ----------------------------------------------------------------------------
 * WebGL viewer for the team's real Fusion 360 assembly.
 *
 * WHAT CHANGED
 * ------------
 * The old code ran the moment the inline <script> executed and bailed out to the
 * flat SVG fallback whenever `typeof THREE === 'undefined'`. Because three.js was
 * a blocking CDN <script> that happened to work, this looked fine — but it made
 * the 3D car silently unavailable on any slow or blocked network, with no retry.
 *
 * It now waits on SM.LibLoader.loadThree(), which walks a CDN chain and finally
 * falls back to ./vendor/three.min.js, so the CAD model renders even offline. The
 * SVG fallback is still shown, but only after every source has genuinely failed
 * or WebGL is unavailable.
 *
 * Geometry comes from SM.Data.CAR_MODEL_B64 (js/data/carModel.js).
 * Registers SM.highlightCarPart so site.js can drive selection.
 * ======================================================================== */
(function (root) {
  'use strict';

  var doc = root.document;
  var canvas = doc.getElementById('car-canvas');
  if (!canvas) return;   // page has no 3D viewer (e.g. greenmach.html)

  function showFallback(reason) {
    canvas.style.display = 'none';
    var fb = doc.getElementById('car-fallback');
    if (fb) fb.style.display = 'flex';
    if (reason && root.console && root.console.warn) {
      root.console.warn('[SilverMach] 3D car viewer unavailable: ' + reason);
    }
  }

  function initCar() {

    if(typeof THREE==='undefined'){showFallback();return;}
    let renderer;
    try{
      renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
    }catch(err){showFallback();return;}
    renderer.setPixelRatio(Math.min(root.devicePixelRatio,2));

    const scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x060708,0.04);
    const camera=new THREE.PerspectiveCamera(40,1,0.1,100);
    camera.position.set(7.8,3.8,8.8);camera.lookAt(0,0.9,0);

    scene.add(new THREE.AmbientLight(0xffffff,0.35));
    scene.add(new THREE.HemisphereLight(0xdfe8ee,0x0a0c10,0.75));
    const key=new THREE.DirectionalLight(0xffffff,1.05);key.position.set(6,10,5);scene.add(key);
    const fill=new THREE.DirectionalLight(0xbfd4de,0.4);fill.position.set(-4,6,8);scene.add(fill);
    const cyanLight=new THREE.PointLight(0x2ad6ee,1.2,44);cyanLight.position.set(-7,3,-4);scene.add(cyanLight);
    const rim=new THREE.DirectionalLight(0x9fdfff,0.55);rim.position.set(-6,2,-7);scene.add(rim);

    const silverMat=new THREE.MeshStandardMaterial({color:0xccd0d6,metalness:.5,roughness:.35});
    const bodyMat =new THREE.MeshStandardMaterial({color:0x1a1d22,metalness:.7,roughness:.35});
    const darkMat =new THREE.MeshStandardMaterial({color:0x14171c,metalness:.3,roughness:.6});
    const cyanMat =new THREE.MeshStandardMaterial({color:0x2ad6ee,metalness:.4,roughness:.25,emissive:0x0a4a55,emissiveIntensity:.6});
    const tireMat =new THREE.MeshStandardMaterial({color:0x0b0c0e,metalness:.15,roughness:.9});
    const rimMat  =new THREE.MeshStandardMaterial({color:0xd6dadf,metalness:.55,roughness:.3});

    const car=new THREE.Group();scene.add(car);
    const partMeshes={body:[],frontwing:[],rearwing:[],wheels:[],co2:[],materials:[]};
    function add(k,geo,mat,px,py,pz,rx,ry,rz){
      const m=new THREE.Mesh(geo,mat);
      m.position.set(px||0,py||0,pz||0);
      if(rx)m.rotation.x=rx; if(ry)m.rotation.y=ry; if(rz)m.rotation.z=rz;
      m.userData.partKey=k;partMeshes[k].push(m);car.add(m);return m;
    }

    /* ---- REAL CAR — decoded from the team's Fusion 360 design (body + wings) ---- */
    const CAR_PARTS_B64=(root.SM.Data||{}).CAR_MODEL_B64||"";
    function decodeGeo(dv,buf,base){
      const nv=dv.getUint32(base,true),nf=dv.getUint32(base+4,true);
      const mn=[dv.getFloat32(base+8,true),dv.getFloat32(base+12,true),dv.getFloat32(base+16,true)];
      const mx=[dv.getFloat32(base+20,true),dv.getFloat32(base+24,true),dv.getFloat32(base+28,true)];
      let o=base+32;
      const qpos=new Uint16Array(buf,o,nv*3);o+=nv*6;
      const qnrm=new Int8Array(buf,o,nv*3);o+=nv*3;
      if(o%2)o++;
      const idx=new Uint16Array(buf,o,nf*3);
      const pos=new Float32Array(nv*3),nrm=new Float32Array(nv*3);
      for(let i=0;i<nv;i++)for(let a=0;a<3;a++){
        pos[i*3+a]=mn[a]+(qpos[i*3+a]/65535)*(mx[a]-mn[a]);
        nrm[i*3+a]=qnrm[i*3+a]/127;
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(pos,3));
      g.setAttribute('normal',new THREE.BufferAttribute(nrm,3));
      g.setIndex(new THREE.BufferAttribute(idx,1));
      return g;
    }
    function decodeParts(b64){
      const bin=atob(b64);const buf=new ArrayBuffer(bin.length);const u8=new Uint8Array(buf);
      for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
      const dv=new DataView(buf);
      const n=dv.getUint32(0,true);let p=4;const out=[];
      for(let k=0;k<n;k++){
        const len=dv.getUint32(p,true);p+=4;
        out.push(decodeGeo(dv,buf,p));p+=len;
      }
      return out;
    }

    /* model coordinates: X = 0 tail → 21 nose, Y up, ground plane at y=-2.9 */
    const model=new THREE.Group();
    car.add(model);
    const S=0.34;model.scale.set(S,S,S);
    model.position.set(0,2.9*S,0);           // wheels touch the grid
    const MX=-10.4;                           // center the length span
    function addM(k,obj){obj.userData.partKey=k;partMeshes[k].push(obj);model.add(obj);return obj;}
    function place(k,geo,mat,px,py,pz,rx,ry,rz){
      const m=new THREE.Mesh(geo,mat);
      m.position.set(px+MX,py,pz);
      if(rx)m.rotation.x=rx;if(ry)m.rotation.y=ry;if(rz)m.rotation.z=rz;
      return addM(k,m);
    }

    const shellMat=new THREE.MeshStandardMaterial({color:0x191919,metalness:.25,roughness:.55,side:THREE.FrontSide});  // Body1: Opaque(25,25,25) + Body1:1 dark gray
    const wingMat =new THREE.MeshStandardMaterial({color:0xa0a0a0,metalness:.50,roughness:.35,side:THREE.FrontSide});  // frontwing: Opaque(160,160,160)
    const innerMat=new THREE.MeshStandardMaterial({color:0x404040,metalness:.2,roughness:.75,side:THREE.BackSide});
    const rearWingMat=new THREE.MeshStandardMaterial({color:0xa0a0a0,metalness:.50,roughness:.35,side:THREE.FrontSide});
    let cadOK=false;
    try{
      const geos=decodeParts(CAR_PARTS_B64);   // [body, front wing, rear wing] — real Fusion 360 export
      const keys=['body','frontwing','rearwing'];
      const mats=[shellMat,wingMat,rearWingMat];
      geos.forEach((g,i)=>{
        g.translate(MX,0,0);
        addM(keys[i],new THREE.Mesh(g,mats[i]));           // outer skin
        addM(keys[i],new THREE.Mesh(g,innerMat));          // dark inner face = shell thickness
      });
      cadOK=true;
    }catch(err){console.warn('CAD decode failed',err);}
    if(!cadOK){
      place('body',new THREE.CylinderGeometry(1.1,1.9,20,10),bodyMat,10.5,1.2,0,0,0,Math.PI/2);
    }

    /* ---- SOFT GROUND SHADOW ---- */
    (function(){
      const c=doc.createElement('canvas');c.width=c.height=256;
      const g=c.getContext('2d');
      const grad=g.createRadialGradient(128,128,10,128,128,120);
      grad.addColorStop(0,'rgba(0,0,0,0.55)');grad.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=grad;g.fillRect(0,0,256,256);
      const tex=new THREE.CanvasTexture(c);
      const sh=new THREE.Mesh(new THREE.PlaneGeometry(9.5,5.2),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));
      sh.rotation.x=-Math.PI/2;sh.position.y=0.01;car.add(sh);
    })();

    /* ---- ENVIRONMENT ---- */
    const grid=new THREE.GridHelper(44,44,0x2ad6ee,0x161a1f);grid.position.y=0;grid.material.opacity=0.16;grid.material.transparent=true;scene.add(grid);
    const ring=new THREE.Mesh(new THREE.RingGeometry(3.6,5.8,48),new THREE.MeshBasicMaterial({color:0x2ad6ee,transparent:true,opacity:0.07,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.y=0.005;scene.add(ring);

    const sparkN=70,sp=new Float32Array(sparkN*3);
    for(let i=0;i<sparkN;i++){sp[i*3]=(Math.random()-.5)*16;sp[i*3+1]=Math.random()*5;sp[i*3+2]=(Math.random()-.5)*16;}
    const sparkGeo=new THREE.BufferGeometry();sparkGeo.setAttribute('position',new THREE.BufferAttribute(sp,3));
    const sparks=new THREE.Points(sparkGeo,new THREE.PointsMaterial({color:0x2ad6ee,size:0.06,transparent:true,opacity:.7}));
    scene.add(sparks);

    /* ---- (highlight-on-tap glow removed) ---- */
    let activeKey='body';
    root.SM.highlightCarPart = function (key) { activeKey = key; };

    /* ---- INTERACTION ---- */
    const ray=new THREE.Raycaster(),mouse=new THREE.Vector2();
    let dragging=false,dragMoved=false,lastX=0,lastY=0,targetRotY=0.5,targetRotX=0.06,autoRotate=true;
    canvas.addEventListener('click',e=>{if(dragMoved)return;const r=canvas.getBoundingClientRect();
      mouse.x=((e.clientX-r.left)/r.width)*2-1;mouse.y=-((e.clientY-r.top)/r.height)*2+1;
      ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects(car.children,true);
      const hit=hits.find(h=>h.object.userData.partKey);
      if(hit){const k=hit.object.userData.partKey;
        // site.js owns part selection; guard in case it has not booted yet.
        if(root.SM.Site&&typeof root.SM.Site.selectPart==='function'){
          root.SM.Site.selectPart(k==='rearwing'?'frontwing':k);
        }}});
    canvas.addEventListener('pointerdown',e=>{dragging=true;dragMoved=false;lastX=e.clientX;lastY=e.clientY;autoRotate=false;});
    root.addEventListener('pointerup',()=>{dragging=false;setTimeout(()=>{if(!dragging)autoRotate=true;},2500);});
    root.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;
      if(Math.abs(dx)+Math.abs(dy)>3)dragMoved=true;targetRotY+=dx*0.01;targetRotX+=dy*0.006;
      targetRotX=Math.max(-0.4,Math.min(0.7,targetRotX));lastX=e.clientX;lastY=e.clientY;});

    function resize(){const w=canvas.clientWidth,h=canvas.clientHeight;
      if(w&&h&&(canvas.width!==w||canvas.height!==h)){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}}
    function animate(){requestAnimationFrame(animate);resize();
      if(autoRotate)targetRotY+=0.004;
      car.rotation.y+=(targetRotY-car.rotation.y)*0.08;
      car.rotation.x+=(targetRotX-car.rotation.x)*0.08;
      cyanLight.intensity=1.1+Math.sin(Date.now()*0.002)*0.25;
      sparks.rotation.y+=0.0009;
      const t=Date.now()*0.0006;camera.position.y=3.8+Math.sin(t)*0.22;camera.lookAt(0,0.9,0);
      renderer.render(scene,camera);}
    animate();
  }

  var loader = root.SM && root.SM.LibLoader;
  if (!loader) { showFallback('library loader missing'); return; }

  loader.loadThree().then(function (info) {
    if (root.console && root.console.info) {
      root.console.info('[SilverMach] three.js loaded from ' + info.source);
    }
    try {
      initCar();
    } catch (err) {
      showFallback(err.message);
    }
  }).catch(function (err) {
    showFallback(err.message);
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
