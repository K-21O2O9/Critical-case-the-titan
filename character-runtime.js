/* TITAN Character Runtime — lightweight, customizable humanoid avatar. */
(function (window) {
  'use strict';
  var KEY = 'titan-character-v1';
  var DEFAULTS = {
    name: 'Explorer',
    gender: 'male',
    outfitStyle: 'deck-uniform',
    skinColor: '#d9a47f',
    outfitColor: '#2b8990',
    accentColor: '#e2bd78',
    hairColor: '#28333b',
    eyeColor: '#26333a',
    hairStyle: 'short',
    accessory: 'none',
    height: 1,
    bodyBuild: 1,
    animationSpeed: 1
  };
  var clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };
  function safeConfig(input) {
    var c = Object.assign({}, DEFAULTS, input || {});
    c.name = String(c.name || 'Explorer').replace(/[<>]/g, '').slice(0, 24) || 'Explorer';
    ['skinColor', 'outfitColor', 'accentColor', 'hairColor', 'eyeColor'].forEach(function (k) {
      if (!/^#[0-9a-f]{6}$/i.test(String(c[k]))) c[k] = DEFAULTS[k];
    });
    c.gender = ['male', 'female'].indexOf(c.gender) >= 0 ? c.gender : 'male';
    c.outfitStyle = ['deck-uniform', 'engineering', 'casual'].indexOf(c.outfitStyle) >= 0 ? c.outfitStyle : 'deck-uniform';
    c.hairStyle = ['short', 'long', 'curly', 'braid', 'bun', 'none'].indexOf(c.hairStyle) >= 0 ? c.hairStyle : 'short';
    c.accessory = ['none', 'glasses', 'cap', 'headset', 'visor'].indexOf(c.accessory) >= 0 ? c.accessory : 'none';
    c.height = clamp(Number(c.height) || 1, .88, 1.12);
    c.bodyBuild = clamp(Number(c.bodyBuild) || 1, .84, 1.18);
    c.animationSpeed = clamp(Number(c.animationSpeed) || 1, .65, 1.5);
    return c;
  }
  function readCharacter() {
    try { return safeConfig(JSON.parse(localStorage.getItem(KEY) || 'null')); }
    catch (_) { return safeConfig(DEFAULTS); }
  }
  function saveCharacter(config) {
    var c = safeConfig(config);
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
      window.dispatchEvent(new CustomEvent('titan-character-changed', { detail: c }));
      return true;
    } catch (err) { return false; }
  }
  function material(THREE, color, roughness) {
    return new THREE.MeshStandardMaterial({ color: color, roughness: roughness == null ? .72 : roughness, metalness: .02 });
  }
  function mesh(THREE, geometry, mat, parent, name, x, y, z) {
    var m = new THREE.Mesh(geometry, mat);
    m.name = name || '';
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function sphere(THREE, mat, parent, name, x, y, z, sx, sy, sz) {
    var m = mesh(THREE, new THREE.SphereGeometry(1, 22, 16), mat, parent, name, x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  }
  function makeLimb(THREE, parent, name, topRadius, bottomRadius, length, mat, y) {
    var g = new THREE.Group();
    g.name = name;
    g.position.y = y || 0;
    parent.add(g);
    mesh(THREE, new THREE.CylinderGeometry(topRadius, bottomRadius, length, 14, 1), mat, g, name + '_segment', 0, -length * .5, 0);
    return g;
  }
  function makeTorso(THREE, parent, mat, build, shoulderRatio) {
    // A low-poly lathed silhouette gives the chest a tapered waist and shoulder
    // line without importing a heavy external mesh or adding skeleton overhead.
    if (THREE.LatheGeometry && THREE.Vector2) {
      var profile = [
        new THREE.Vector2(.205, -.535),
        new THREE.Vector2(.255, -.47),
        new THREE.Vector2(.285, -.30),
        new THREE.Vector2(.300, -.12),
        new THREE.Vector2(.345, .10),
        new THREE.Vector2(.395, .34),
        new THREE.Vector2(.365, .47),
        new THREE.Vector2(.295, .535),
        new THREE.Vector2(.17, .55)
      ];
      var torso = mesh(THREE, new THREE.LatheGeometry(profile, 20), mat, parent, 'Torso', 0, 1.42, 0);
      torso.scale.set(build * shoulderRatio, 1, build * .72);
      return torso;
    }
    return sphere(THREE, mat, parent, 'Torso', 0, 1.42, 0, .405 * build * shoulderRatio, .55, .255 * build);
  }
  function makeHair(THREE, head, hairMat, style) {
    if (style === 'none') return;
    sphere(THREE, hairMat, head, 'Hair_Cap', 0, .19, -.005, .325, .19, .31);
    if (style === 'long') {
      sphere(THREE, hairMat, head, 'Hair_Left', -.255, -.01, -.005, .105, .34, .17);
      sphere(THREE, hairMat, head, 'Hair_Right', .255, -.01, -.005, .105, .34, .17);
      sphere(THREE, hairMat, head, 'Hair_Back', 0, -.12, -.19, .27, .26, .12);
    } else if (style === 'curly') {
      [[-.22,.27,.02],[0,.34,.02],[.22,.27,.02],[-.12,.36,-.06],[.12,.36,-.06]].forEach(function (p, i) {
        sphere(THREE, hairMat, head, 'Curl_' + i, p[0], p[1], p[2], .115, .12, .12);
      });
    } else {
      sphere(THREE, hairMat, head, 'Hair_Front', 0, .105, -.225, .24, .10, .12);
      sphere(THREE, hairMat, head, 'Hair_Side', -.255, .04, -.01, .09, .18, .16);
    }
  }
  function makeGlasses(THREE, head, mat) {
    var frameMat = mat;
    [-1, 1].forEach(function (side) {
      var rim = mesh(THREE, new THREE.TorusGeometry(.073, .009, 7, 24), frameMat, head, 'Glasses_Rim', side * .105, -.035, -.274);
      rim.scale.x = 1.12;
    });
    mesh(THREE, new THREE.BoxGeometry(.08, .014, .014), frameMat, head, 'Glasses_Bridge', 0, -.035, -.281);
    [-1, 1].forEach(function (side) { mesh(THREE, new THREE.BoxGeometry(.105, .012, .012), frameMat, head, 'Glasses_Arm', side * .25, -.02, -.17); });
  }
  function createModel(THREE, config, options) {
    var cfg = safeConfig(config);
    var opts = options || {};
    var root = new THREE.Group();
    root.name = 'TITAN_Custom_Explorer';
    root.scale.setScalar(opts.scale || 1);
    root.scale.y *= cfg.height;
    root.userData.config = cfg;
    // Keep the model root exclusively for world/network transforms. Animation
    // bobbing belongs on this inner rig so it cannot overwrite remote positions.
    var visualRoot = new THREE.Group();
    visualRoot.name = 'TITAN_Character_Visual_Root';
    root.add(visualRoot);
    var skin = material(THREE, cfg.skinColor, .78);
    var outfit = material(THREE, cfg.outfitColor, .68);
    var accent = material(THREE, cfg.accentColor, .48);
    var hair = material(THREE, cfg.hairColor, .9);
    var eyes = material(THREE, cfg.eyeColor, .42);
    var white = material(THREE, '#f5f6f2', .32);
    var dark = material(THREE, '#17232b', .58);
    var shoeMat = material(THREE, '#202c34', .7);
    var build = cfg.bodyBuild;
    var female = cfg.gender === 'female';
    var shoulderRatio = female ? .94 : 1;
    var hipRatio = female ? 1.12 : 1;
    var uniform = cfg.outfitStyle === 'engineering' ? '#596b64' : (cfg.outfitStyle === 'casual' ? '#435f7c' : cfg.outfitColor);
    outfit.color.set(uniform);
    var torsoPivot = new THREE.Group();
    torsoPivot.name = 'Torso_Pivot';
    visualRoot.add(torsoPivot);
    makeTorso(THREE, torsoPivot, outfit, build, shoulderRatio);
    sphere(THREE, outfit, visualRoot, 'Pelvis', 0, 1.00, 0, .31 * build * hipRatio, .25, .235 * build);
    mesh(THREE, new THREE.BoxGeometry(.47 * build * hipRatio, .065, .28), accent, visualRoot, 'Belt', 0, 1.03, .004);
    mesh(THREE, new THREE.BoxGeometry(.10, .105, .018), dark, visualRoot, 'Belt_Buckle', 0, 1.03, .147);
    mesh(THREE, new THREE.CylinderGeometry(.115, .13, .17, 18), skin, visualRoot, 'Neck', 0, 1.83, 0);
    var headPivot = new THREE.Group();
    headPivot.name = 'Head_Pivot';
    headPivot.position.set(0, 2.08, 0);
    visualRoot.add(headPivot);
    sphere(THREE, skin, headPivot, 'Head', 0, 0, 0, female ? .298 : .305, .345, .29);
    [-1, 1].forEach(function(side) { sphere(THREE, skin, headPivot, 'Ear', side * .302, -.015, 0, .052, .085, .045); });
    makeHair(THREE, headPivot, hair, cfg.hairStyle);
    [-1, 1].forEach(function (side) {
      sphere(THREE, white, headPivot, 'Eye_White', side * .105, -.035, -.258, .052, .060, .026);
      sphere(THREE, eyes, headPivot, 'Eye_Pupil', side * .105, -.037, -.280, .027, .033, .014);
      sphere(THREE, white, headPivot, 'Eye_Glint', side * .113, -.023, -.292, .009, .011, .006);
      var brow = mesh(THREE, new THREE.BoxGeometry(.075, .014, .018), hair, headPivot, 'Eyebrow', side * .105, .055, -.263);
      brow.rotation.z = side * -.10;
    });
    sphere(THREE, skin, headPivot, 'Nose', 0, -.105, -.286, .035, .045, .032);
    var smileCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.065, -.17, -.264), new THREE.Vector3(0, -.188, -.285), new THREE.Vector3(.065, -.17, -.264)
    ]);
    mesh(THREE, new THREE.TubeGeometry(smileCurve, 12, .008, 6, false), dark, headPivot, 'Smile', 0, 0, 0);
    if (cfg.accessory === 'glasses') makeGlasses(THREE, headPivot, dark);
    if (cfg.hairStyle === 'braid') {
      sphere(THREE, hair, headPivot, 'Braid_Base', .22, -.08, -.015, .09, .22, .09);
      [-.18, -.29, -.40].forEach(function(y, i) { sphere(THREE, hair, headPivot, 'Braid_Link_' + i, .25, y, -.015, .075, .09, .075); });
    } else if (cfg.hairStyle === 'bun') {
      sphere(THREE, hair, headPivot, 'Hair_Bun', 0, .17, -.25, .13, .14, .13);
    }
    if (cfg.accessory === 'cap') {
      sphere(THREE, accent, headPivot, 'Cap_Crown', 0, .235, -.025, .33, .12, .31);
      mesh(THREE, new THREE.CylinderGeometry(.23, .23, .026, 28), accent, headPivot, 'Cap_Brim', 0, .16, -.13).rotation.x = -.13;
    } else if (cfg.accessory === 'headset') {
      var band = mesh(THREE, new THREE.TorusGeometry(.29, .018, 7, 28, Math.PI), dark, headPivot, 'Headset_Band', 0, .06, 0);
      band.rotation.z = Math.PI;
      [-1, 1].forEach(function(side) { sphere(THREE, accent, headPivot, 'Headset_EarCup', side * .30, -.03, 0, .065, .09, .065); });
    } else if (cfg.accessory === 'visor') {
      mesh(THREE, new THREE.BoxGeometry(.48, .07, .018), accent, headPivot, 'Visor', 0, .065, -.278);
    }

    // Functional-looking uniform details, deliberately low polygon and shared
    // materials to keep avatar memory and draw-call costs modest.
    if (cfg.outfitStyle !== 'casual') {
      [-1, 1].forEach(function(side) {
        mesh(THREE, new THREE.BoxGeometry(.105, .13, .018), accent, visualRoot, 'Chest_Pocket', side * .22, 1.49, -.254);
        mesh(THREE, new THREE.BoxGeometry(.018, .20, .012), accent, visualRoot, 'Uniform_Seam', side * .34, 1.45, -.245);
      });
      mesh(THREE, new THREE.BoxGeometry(.11, .07, .022), accent, visualRoot, 'Crew_Badge', -.20, 1.72, -.258);
      if (cfg.outfitStyle === 'engineering') {
        mesh(THREE, new THREE.BoxGeometry(.34, .055, .022), dark, visualRoot, 'Utility_Stripe', 0, 1.20, -.244);
        [-1,1].forEach(function(side) { sphere(THREE, accent, visualRoot, 'Knee_Pad', side * .17, .50, -.075, .12, .09, .04); });
      }
    }

    var arms = {};
    [-1, 1].forEach(function (side) {
      var label = side < 0 ? 'Left' : 'Right';
      var shoulder = new THREE.Group();
      shoulder.name = label + '_Arm_Pivot';
      shoulder.position.set(side * .405 * build * shoulderRatio, 1.72, 0);
      visualRoot.add(shoulder);
      sphere(THREE, outfit, shoulder, label + '_Shoulder', 0, -.04, 0, .135, .15, .14);
      var upper = makeLimb(THREE, shoulder, label + '_Upper_Arm', .118, .10, .39, outfit, -.12);
      sphere(THREE, outfit, shoulder, label + '_Sleeve_Cuff', 0, -.37, 0, .112, .075, .115);
      var elbow = new THREE.Group();
      elbow.name = label + '_Elbow_Pivot';
      elbow.position.y = -.405;
      shoulder.add(elbow);
      sphere(THREE, skin, elbow, label + '_Elbow', 0, -.015, 0, .09, .09, .09);
      makeLimb(THREE, elbow, label + '_Forearm', .087, .07, .34, skin, -.04);
      sphere(THREE, skin, elbow, label + '_Hand', 0, -.245, .015, .09, .105, .07);
      [-1,0,1].forEach(function (finger) {
        sphere(THREE, skin, elbow, label + '_Finger_' + finger, finger * .043, -.32, .03, .028, .07, .03);
      });
      arms[label.toLowerCase()] = { upper: shoulder, elbow: elbow };
    });

    var legs = {};
    [-1, 1].forEach(function (side) {
      var label = side < 0 ? 'Left' : 'Right';
      var hip = new THREE.Group();
      hip.name = label + '_Leg_Pivot';
      hip.position.set(side * .17 * build * hipRatio, .92, 0);
      visualRoot.add(hip);
      makeLimb(THREE, hip, label + '_Thigh', .145, .125, .42, outfit, 0);
      var knee = new THREE.Group();
      knee.name = label + '_Knee_Pivot';
      knee.position.y = -.42;
      hip.add(knee);
      sphere(THREE, outfit, knee, label + '_Knee', 0, -.01, 0, .12, .12, .12);
      makeLimb(THREE, knee, label + '_Shin', .105, .085, .39, outfit, -.02);
      sphere(THREE, shoeMat, knee, label + '_Shoe', 0, -.245, .075, .135, .085, .21);
      legs[label.toLowerCase()] = { hip: hip, knee: knee };
    });
    var rig = { visualRoot: visualRoot, torso: torsoPivot, head: headPivot, arms: arms, legs: legs, action: null, actionStart: 0, eyes: [] };
    headPivot.traverse(function (o) { if (o.name === 'Eye_White') rig.eyes.push(o); });
    root.userData.rig = rig;
    root.userData.materials = [skin, outfit, accent, hair, eyes, white, dark, shoeMat];
    return root;
  }
  function animateModel(model, time, movement, speed, locomotion) {
    if (!model || !model.userData.rig) return;
    var rig = model.userData.rig;
    var t = (Number(time) || 0) * clamp(Number(speed) || 1, .5, 1.8);
    var axes = locomotion && typeof locomotion === 'object' ? locomotion : {};
    var forward = clamp(Number(axes.moveForward) || 0, -1, 1);
    var strafe = clamp(Number(axes.moveStrafe) || 0, -1, 1);
    var walk = clamp(Number(movement) || Math.max(Math.abs(forward), Math.abs(strafe)), 0, 1);
    var signedStride = Math.sin(t * 8.2) * walk * (Math.abs(forward) > .12 ? (forward < 0 ? -1 : 1) : .58);
    var sideStride = Math.sin(t * 8.2 + Math.PI / 2) * strafe * walk;
    if (rig.visualRoot) rig.visualRoot.position.y = Math.abs(Math.sin(t * 4.1)) * (.006 + walk * .018);
    rig.torso.scale.y = 1 + Math.sin(t * 2.1) * .008;
    rig.torso.rotation.z = -strafe * .035;
    rig.head.rotation.y = Math.sin(t * .72) * .045;
    rig.head.rotation.z = Math.sin(t * .9) * .012 - strafe * .025;
    rig.arms.left.upper.rotation.x = signedStride * .48 + Math.sin(t * 1.45) * .012;
    rig.arms.right.upper.rotation.x = -signedStride * .48 + Math.sin(t * 1.45 + .5) * .012;
    rig.arms.left.upper.rotation.z = .08 + sideStride * .30;
    rig.arms.right.upper.rotation.z = -.08 + sideStride * .30;
    rig.arms.left.elbow.rotation.x = -.10 + Math.max(0, signedStride) * .18;
    rig.arms.right.elbow.rotation.x = -.10 + Math.max(0, -signedStride) * .18;
    rig.legs.left.hip.rotation.x = signedStride * .62;
    rig.legs.right.hip.rotation.x = -signedStride * .62;
    rig.legs.left.hip.rotation.z = -sideStride * .22;
    rig.legs.right.hip.rotation.z = -sideStride * .22;
    rig.legs.left.knee.rotation.x = Math.max(0, -signedStride) * .7;
    rig.legs.right.knee.rotation.x = Math.max(0, signedStride) * .7;
    var actionT = rig.action ? (performance.now() - rig.actionStart) / 1000 : 99;
    if (rig.action === 'wave' && actionT < 1.55) {
      var fade = Math.sin(Math.PI * clamp(actionT / 1.55, 0, 1));
      rig.arms.right.upper.rotation.z = -2.0 * fade;
      rig.arms.right.upper.rotation.x = .1 + Math.sin(actionT * 13) * .16 * fade;
      rig.arms.right.elbow.rotation.x = -1.15 + Math.sin(actionT * 13) * .24 * fade;
    } else {
      rig.arms.right.upper.rotation.z *= .82;
      rig.arms.right.elbow.rotation.x *= .82;
      if (actionT >= 1.55) rig.action = null;
    }
    var blinkPhase = (t % 4.4);
    var blink = blinkPhase > 4.15 ? Math.max(.08, Math.abs(Math.sin((blinkPhase - 4.15) / .25 * Math.PI))) : 1;
    rig.eyes.forEach(function (eye) { eye.scale.y = .060 * blink; });
  }
  function playAction(model, action) {
    if (!model || !model.userData.rig) return;
    model.userData.rig.action = action || 'wave';
    model.userData.rig.actionStart = performance.now();
  }
  function createFirstPersonArms(THREE, config) {
    var cfg = safeConfig(config);
    var group = new THREE.Group();
    group.name = 'TITAN_First_Person_Arms';
    group.position.set(0, -.07, -.95);
    var outfit = material(THREE, cfg.outfitColor, .65);
    var skin = material(THREE, cfg.skinColor, .78);
    var accent = material(THREE, cfg.accentColor, .5);
    var armPivots = {};
    [-1, 1].forEach(function (side) {
      var key = side < 0 ? 'left' : 'right';
      var pivot = new THREE.Group();
      pivot.position.set(side * .35, -.01, 0);
      pivot.rotation.z = side * -.10;
      group.add(pivot);
      mesh(THREE, new THREE.CylinderGeometry(.12, .10, .29, 14), outfit, pivot, key + '_sleeve', 0, -.145, 0);
      sphere(THREE, accent, pivot, key + '_cuff', 0, -.285, 0, .108, .045, .105);
      mesh(THREE, new THREE.CylinderGeometry(.078, .066, .25, 14), skin, pivot, key + '_forearm', 0, -.435, .008);
      sphere(THREE, skin, pivot, key + '_hand', 0, -.565, .035, .085, .095, .068);
      [-1,0,1].forEach(function (finger) { sphere(THREE, skin, pivot, key + '_finger', finger * .039, -.632, .06, .024, .055, .026); });
      armPivots[key] = pivot;
    });
    group.userData.armPivots = armPivots;
    group.userData.actionStart = 0;
    return group;
  }
  function updateFirstPersonArms(group, time, movement, speed) {
    if (!group || !group.userData.armPivots) return;
    var t = (Number(time) || 0) * clamp(Number(speed) || 1, .5, 1.8);
    var walk = clamp(Number(movement) || 0, 0, 1);
    var swing = Math.sin(t * 8.2) * walk * .13;
    group.position.y = -.07 + Math.abs(Math.sin(t * 4.1)) * (.012 + walk * .025);
    group.userData.armPivots.left.rotation.x = swing + Math.sin(t * 1.5) * .018;
    group.userData.armPivots.right.rotation.x = -swing + Math.sin(t * 1.5 + .3) * .018;
    var action = group.userData.actionStart ? (performance.now() - group.userData.actionStart) / 1000 : 99;
    if (action < .9) {
      var lift = Math.sin(Math.PI * clamp(action / .9, 0, 1));
      group.userData.armPivots.right.rotation.z = -1.0 * lift;
      group.userData.armPivots.right.rotation.x += Math.sin(action * 18) * .12 * lift;
    } else {
      group.userData.armPivots.right.rotation.z *= .82;
    }
  }
  function playFirstPersonAction(group) { if (group) group.userData.actionStart = performance.now(); }
  window.TitanCharacterRuntime = {
    KEY: KEY, FORWARD_AXIS: '-Z', AVATAR_GEOMETRY: 'low-poly-lathe-humanoid', defaults: Object.assign({}, DEFAULTS), readCharacter: readCharacter, saveCharacter: saveCharacter,
    normalize: safeConfig, createModel: createModel, animateModel: animateModel, playAction: playAction,
    createFirstPersonArms: createFirstPersonArms, updateFirstPersonArms: updateFirstPersonArms,
    playFirstPersonAction: playFirstPersonAction
  };
})(window);
