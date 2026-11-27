/* TITAN Character Runtime — high-quality low-poly humanoid avatar (graphics rework). */
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
  function material(THREE, color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness == null ? .68 : roughness,
      metalness: metalness == null ? .04 : metalness
    });
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
    var m = mesh(THREE, new THREE.SphereGeometry(1, 28, 20), mat, parent, name, x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  }
  function makeLimb(THREE, parent, name, topRadius, bottomRadius, length, mat, y) {
    var g = new THREE.Group();
    g.name = name;
    g.position.y = y || 0;
    parent.add(g);
    mesh(THREE, new THREE.CylinderGeometry(topRadius, bottomRadius, length, 16, 1), mat, g, name + '_segment', 0, -length * .5, 0);
    return g;
  }
  function makeTorso(THREE, parent, mat, build, shoulderRatio) {
    // High-resolution lathed torso with refined silhouette: broad shoulders,
    // natural chest taper, defined waist, and clean hip transition.
    if (THREE.LatheGeometry && THREE.Vector2) {
      var profile = [
        new THREE.Vector2(.175, -.545),
        new THREE.Vector2(.225, -.510),
        new THREE.Vector2(.255, -.455),
        new THREE.Vector2(.275, -.380),
        new THREE.Vector2(.285, -.280),
        new THREE.Vector2(.295, -.160),
        new THREE.Vector2(.310, -.040),
        new THREE.Vector2(.340, .080),
        new THREE.Vector2(.375, .220),
        new THREE.Vector2(.405, .340),
        new THREE.Vector2(.395, .430),
        new THREE.Vector2(.355, .500),
        new THREE.Vector2(.295, .540),
        new THREE.Vector2(.210, .555),
        new THREE.Vector2(.145, .560)
      ];
      var torso = mesh(THREE, new THREE.LatheGeometry(profile, 28), mat, parent, 'Torso', 0, 1.42, 0);
      torso.scale.set(build * shoulderRatio, 1, build * .74);
      return torso;
    }
    return sphere(THREE, mat, parent, 'Torso', 0, 1.42, 0, .405 * build * shoulderRatio, .55, .255 * build);
  }
  function makeHair(THREE, head, hairMat, style) {
    if (style === 'none') return;
    // Base scalp coverage
    sphere(THREE, hairMat, head, 'Hair_Cap', 0, .195, -.008, .335, .195, .318);
    if (style === 'long') {
      sphere(THREE, hairMat, head, 'Hair_Left', -.265, -.02, -.01, .115, .38, .18);
      sphere(THREE, hairMat, head, 'Hair_Right', .265, -.02, -.01, .115, .38, .18);
      sphere(THREE, hairMat, head, 'Hair_Back', 0, -.14, -.205, .285, .30, .135);
      sphere(THREE, hairMat, head, 'Hair_Back_Lower', 0, -.28, -.16, .22, .18, .12);
    } else if (style === 'curly') {
      [
        [-.24, .28, .03], [0, .36, .04], [.24, .28, .03],
        [-.14, .38, -.05], [.14, .38, -.05],
        [-.20, .22, -.12], [.20, .22, -.12], [0, .30, -.14]
      ].forEach(function (p, i) {
        sphere(THREE, hairMat, head, 'Curl_' + i, p[0], p[1], p[2], .12, .125, .12);
      });
    } else if (style === 'braid') {
      sphere(THREE, hairMat, head, 'Hair_Front', 0, .11, -.23, .25, .11, .13);
      sphere(THREE, hairMat, head, 'Hair_Side_L', -.26, .05, -.01, .095, .20, .17);
      sphere(THREE, hairMat, head, 'Hair_Side_R', .26, .05, -.01, .095, .20, .17);
    } else if (style === 'bun') {
      sphere(THREE, hairMat, head, 'Hair_Front', 0, .11, -.23, .25, .11, .13);
      sphere(THREE, hairMat, head, 'Hair_Side_L', -.26, .05, -.01, .095, .20, .17);
      sphere(THREE, hairMat, head, 'Hair_Side_R', .26, .05, -.01, .095, .20, .17);
    } else {
      // short
      sphere(THREE, hairMat, head, 'Hair_Front', 0, .115, -.235, .255, .11, .13);
      sphere(THREE, hairMat, head, 'Hair_Side_L', -.265, .05, -.01, .095, .195, .17);
      sphere(THREE, hairMat, head, 'Hair_Side_R', .265, .05, -.01, .095, .195, .17);
      sphere(THREE, hairMat, head, 'Hair_Top', 0, .28, -.02, .22, .10, .22);
    }
  }
  function makeGlasses(THREE, head, mat) {
    var frameMat = mat;
    [-1, 1].forEach(function (side) {
      var rim = mesh(THREE, new THREE.TorusGeometry(.076, .010, 8, 28), frameMat, head, 'Glasses_Rim', side * .108, -.034, -.278);
      rim.scale.x = 1.14;
    });
    mesh(THREE, new THREE.BoxGeometry(.085, .015, .015), frameMat, head, 'Glasses_Bridge', 0, -.034, -.285);
    [-1, 1].forEach(function (side) {
      mesh(THREE, new THREE.BoxGeometry(.11, .013, .013), frameMat, head, 'Glasses_Arm', side * .255, -.018, -.175);
    });
  }
  function createModel(THREE, config, options) {
    var cfg = safeConfig(config);
    var opts = options || {};
    var root = new THREE.Group();
    root.name = 'TITAN_Custom_Explorer';
    root.scale.setScalar(opts.scale || 1);
    root.scale.y *= cfg.height;
    root.userData.config = cfg;
    // Outer root is exclusively for world/network transforms.
    // All animation bobbing lives on the inner visual rig.
    var visualRoot = new THREE.Group();
    visualRoot.name = 'TITAN_Character_Visual_Root';
    root.add(visualRoot);

    var skin = material(THREE, cfg.skinColor, .76, .02);
    var outfit = material(THREE, cfg.outfitColor, .62, .06);
    var accent = material(THREE, cfg.accentColor, .42, .18);
    var hair = material(THREE, cfg.hairColor, .88, .01);
    var eyes = material(THREE, cfg.eyeColor, .28, .12);
    var white = material(THREE, '#f7f8f4', .28, .05);
    var dark = material(THREE, '#141e26', .55, .08);
    var shoeMat = material(THREE, '#1a252e', .72, .05);
    var bootMat = material(THREE, '#1e2a33', .68, .08);

    var build = cfg.bodyBuild;
    var female = cfg.gender === 'female';
    var shoulderRatio = female ? .93 : 1.0;
    var hipRatio = female ? 1.14 : 1.0;
    var uniform = cfg.outfitStyle === 'engineering' ? '#4f635c' : (cfg.outfitStyle === 'casual' ? '#3d5a72' : cfg.outfitColor);
    outfit.color.set(uniform);

    // --- TORSO & CORE ---
    var torsoPivot = new THREE.Group();
    torsoPivot.name = 'Torso_Pivot';
    visualRoot.add(torsoPivot);
    makeTorso(THREE, torsoPivot, outfit, build, shoulderRatio);

    // Pelvis / hips
    sphere(THREE, outfit, visualRoot, 'Pelvis', 0, 1.00, 0, .32 * build * hipRatio, .26, .245 * build);

    // Belt
    mesh(THREE, new THREE.BoxGeometry(.50 * build * hipRatio, .068, .30), accent, visualRoot, 'Belt', 0, 1.035, .004);
    mesh(THREE, new THREE.BoxGeometry(.105, .11, .020), dark, visualRoot, 'Belt_Buckle', 0, 1.035, .155);

    // Collar / neckline
    if (cfg.outfitStyle !== 'casual') {
      mesh(THREE, new THREE.BoxGeometry(.38 * build * shoulderRatio, .045, .22), accent, visualRoot, 'Collar', 0, 1.78, .02);
    }

    // Neck
    mesh(THREE, new THREE.CylinderGeometry(.118, .132, .18, 20), skin, visualRoot, 'Neck', 0, 1.84, 0);

    // --- HEAD ---
    var headPivot = new THREE.Group();
    headPivot.name = 'Head_Pivot';
    headPivot.position.set(0, 2.09, 0);
    visualRoot.add(headPivot);
    sphere(THREE, skin, headPivot, 'Head', 0, 0, 0, female ? .302 : .310, .355, .295);
    [-1, 1].forEach(function (side) {
      sphere(THREE, skin, headPivot, 'Ear', side * .308, -.018, .005, .055, .092, .048);
    });
    makeHair(THREE, headPivot, hair, cfg.hairStyle);

    // Eyes
    [-1, 1].forEach(function (side) {
      sphere(THREE, white, headPivot, 'Eye_White', side * .108, -.032, -.262, .055, .062, .028);
      sphere(THREE, eyes, headPivot, 'Eye_Pupil', side * .108, -.034, -.285, .029, .035, .015);
      sphere(THREE, white, headPivot, 'Eye_Glint', side * .116, -.020, -.298, .010, .012, .007);
      var brow = mesh(THREE, new THREE.BoxGeometry(.082, .015, .020), hair, headPivot, 'Eyebrow', side * .108, .060, -.268);
      brow.rotation.z = side * -.12;
    });

    // Nose
    sphere(THREE, skin, headPivot, 'Nose', 0, -.100, -.292, .038, .048, .035);

    // Mouth (subtle smile curve)
    var smileCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-.070, -.175, -.268),
      new THREE.Vector3(0, -.195, -.292),
      new THREE.Vector3(.070, -.175, -.268)
    ]);
    mesh(THREE, new THREE.TubeGeometry(smileCurve, 14, .009, 7, false), dark, headPivot, 'Smile', 0, 0, 0);

    // Accessories
    if (cfg.accessory === 'glasses') makeGlasses(THREE, headPivot, dark);
    if (cfg.hairStyle === 'braid') {
      sphere(THREE, hair, headPivot, 'Braid_Base', .235, -.075, -.02, .095, .24, .095);
      [-.16, -.28, -.40, -.50].forEach(function (y, i) {
        sphere(THREE, hair, headPivot, 'Braid_Link_' + i, .26, y, -.02, .078, .095, .078);
      });
    } else if (cfg.hairStyle === 'bun') {
      sphere(THREE, hair, headPivot, 'Hair_Bun', 0, .185, -.255, .14, .15, .14);
      sphere(THREE, hair, headPivot, 'Hair_Bun_Base', 0, .12, -.22, .12, .08, .12);
    }
    if (cfg.accessory === 'cap') {
      sphere(THREE, accent, headPivot, 'Cap_Crown', 0, .245, -.02, .34, .125, .32);
      var brim = mesh(THREE, new THREE.CylinderGeometry(.24, .24, .028, 32), accent, headPivot, 'Cap_Brim', 0, .165, -.14);
      brim.rotation.x = -.14;
    } else if (cfg.accessory === 'headset') {
      var band = mesh(THREE, new THREE.TorusGeometry(.30, .020, 8, 32, Math.PI), dark, headPivot, 'Headset_Band', 0, .065, 0);
      band.rotation.z = Math.PI;
      [-1, 1].forEach(function (side) {
        sphere(THREE, accent, headPivot, 'Headset_EarCup', side * .31, -.025, 0, .070, .095, .070);
      });
    } else if (cfg.accessory === 'visor') {
      mesh(THREE, new THREE.BoxGeometry(.50, .075, .020), accent, headPivot, 'Visor', 0, .070, -.282);
    }

    // --- UNIFORM DETAILS ---
    if (cfg.outfitStyle !== 'casual') {
      [-1, 1].forEach(function (side) {
        mesh(THREE, new THREE.BoxGeometry(.112, .14, .020), accent, visualRoot, 'Chest_Pocket', side * .225, 1.50, -.258);
        mesh(THREE, new THREE.BoxGeometry(.020, .22, .014), accent, visualRoot, 'Uniform_Seam', side * .355, 1.46, -.250);
      });
      mesh(THREE, new THREE.BoxGeometry(.12, .075, .024), accent, visualRoot, 'Crew_Badge', -.215, 1.74, -.262);
      if (cfg.outfitStyle === 'engineering') {
        mesh(THREE, new THREE.BoxGeometry(.36, .060, .024), dark, visualRoot, 'Utility_Stripe', 0, 1.21, -.248);
        [-1, 1].forEach(function (side) {
          sphere(THREE, accent, visualRoot, 'Knee_Pad', side * .175, .50, -.08, .13, .095, .045);
        });
      }
    }

    // --- ARMS ---
    var arms = {};
    [-1, 1].forEach(function (side) {
      var label = side < 0 ? 'Left' : 'Right';
      var shoulder = new THREE.Group();
      shoulder.name = label + '_Arm_Pivot';
      shoulder.position.set(side * .415 * build * shoulderRatio, 1.73, 0);
      visualRoot.add(shoulder);

      sphere(THREE, outfit, shoulder, label + '_Shoulder', 0, -.035, 0, .142, .155, .145);
      var upper = makeLimb(THREE, shoulder, label + '_Upper_Arm', .122, .102, .40, outfit, -.125);
      sphere(THREE, outfit, shoulder, label + '_Sleeve_Cuff', 0, -.38, 0, .116, .078, .118);

      var elbow = new THREE.Group();
      elbow.name = label + '_Elbow_Pivot';
      elbow.position.y = -.415;
      shoulder.add(elbow);
      sphere(THREE, skin, elbow, label + '_Elbow', 0, -.012, 0, .092, .092, .092);
      makeLimb(THREE, elbow, label + '_Forearm', .090, .072, .35, skin, -.045);

      // Hand with better finger layout
      sphere(THREE, skin, elbow, label + '_Hand', 0, -.255, .018, .092, .108, .075);
      [-1, 0, 1].forEach(function (finger) {
        sphere(THREE, skin, elbow, label + '_Finger_' + finger, finger * .045, -.335, .038, .030, .075, .032);
      });
      // Thumb
      sphere(THREE, skin, elbow, label + '_Thumb', side * .055, -.28, .055, .028, .055, .030);

      arms[label.toLowerCase()] = { upper: shoulder, elbow: elbow };
    });

    // --- LEGS ---
    var legs = {};
    [-1, 1].forEach(function (side) {
      var label = side < 0 ? 'Left' : 'Right';
      var hip = new THREE.Group();
      hip.name = label + '_Leg_Pivot';
      hip.position.set(side * .175 * build * hipRatio, .93, 0);
      visualRoot.add(hip);

      makeLimb(THREE, hip, label + '_Thigh', .150, .128, .43, outfit, 0);
      var knee = new THREE.Group();
      knee.name = label + '_Knee_Pivot';
      knee.position.y = -.43;
      hip.add(knee);
      sphere(THREE, outfit, knee, label + '_Knee', 0, -.008, 0, .125, .125, .125);
      makeLimb(THREE, knee, label + '_Shin', .108, .088, .40, outfit, -.02);

      // Boot (more substantial than simple shoe)
      sphere(THREE, bootMat, knee, label + '_Boot_Ankle', 0, -.24, .02, .125, .10, .14);
      sphere(THREE, shoeMat, knee, label + '_Shoe', 0, -.255, .085, .145, .090, .225);
      mesh(THREE, new THREE.BoxGeometry(.16, .04, .22), shoeMat, knee, label + '_Sole', 0, -.295, .09);

      legs[label.toLowerCase()] = { hip: hip, knee: knee };
    });

    var rig = {
      visualRoot: visualRoot,
      torso: torsoPivot,
      head: headPivot,
      arms: arms,
      legs: legs,
      action: null,
      actionStart: 0,
      eyes: []
    };
    headPivot.traverse(function (o) { if (o.name === 'Eye_White') rig.eyes.push(o); });
    root.userData.rig = rig;
    root.userData.materials = [skin, outfit, accent, hair, eyes, white, dark, shoeMat, bootMat];
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
    var signedStride = Math.sin(t * 8.0) * walk * (Math.abs(forward) > .12 ? (forward < 0 ? -1 : 1) : .55);
    var sideStride = Math.sin(t * 8.0 + Math.PI / 2) * strafe * walk;

    // Bob only the inner visual root — never the network-owned model root
    if (rig.visualRoot) {
      rig.visualRoot.position.y = Math.abs(Math.sin(t * 4.0)) * (.007 + walk * .022);
    }

    // Subtle breathing + torso lean
    rig.torso.scale.y = 1 + Math.sin(t * 1.9) * .009;
    rig.torso.rotation.z = -strafe * .04;
    rig.torso.rotation.x = Math.sin(t * 1.9) * .008 * (1 - walk * .4);

    // Head look / idle
    rig.head.rotation.y = Math.sin(t * .68) * .05;
    rig.head.rotation.z = Math.sin(t * .85) * .014 - strafe * .028;
    rig.head.rotation.x = Math.sin(t * 1.1) * .012;

    // Arms
    rig.arms.left.upper.rotation.x = signedStride * .52 + Math.sin(t * 1.4) * .014;
    rig.arms.right.upper.rotation.x = -signedStride * .52 + Math.sin(t * 1.4 + .5) * .014;
    rig.arms.left.upper.rotation.z = .09 + sideStride * .32;
    rig.arms.right.upper.rotation.z = -.09 + sideStride * .32;
    rig.arms.left.elbow.rotation.x = -.12 + Math.max(0, signedStride) * .20;
    rig.arms.right.elbow.rotation.x = -.12 + Math.max(0, -signedStride) * .20;

    // Legs
    rig.legs.left.hip.rotation.x = signedStride * .68;
    rig.legs.right.hip.rotation.x = -signedStride * .68;
    rig.legs.left.hip.rotation.z = -sideStride * .24;
    rig.legs.right.hip.rotation.z = -sideStride * .24;
    rig.legs.left.knee.rotation.x = Math.max(0, -signedStride) * .75;
    rig.legs.right.knee.rotation.x = Math.max(0, signedStride) * .75;

    // Wave action
    var actionT = rig.action ? (performance.now() - rig.actionStart) / 1000 : 99;
    if (rig.action === 'wave' && actionT < 1.55) {
      var fade = Math.sin(Math.PI * clamp(actionT / 1.55, 0, 1));
      rig.arms.right.upper.rotation.z = -2.05 * fade;
      rig.arms.right.upper.rotation.x = .12 + Math.sin(actionT * 12.5) * .18 * fade;
      rig.arms.right.elbow.rotation.x = -1.20 + Math.sin(actionT * 12.5) * .26 * fade;
    } else {
      rig.arms.right.upper.rotation.z *= .80;
      rig.arms.right.elbow.rotation.x *= .80;
      if (actionT >= 1.55) rig.action = null;
    }

    // Blink
    var blinkPhase = (t % 4.5);
    var blink = blinkPhase > 4.22 ? Math.max(.06, Math.abs(Math.sin((blinkPhase - 4.22) / .28 * Math.PI))) : 1;
    rig.eyes.forEach(function (eye) { eye.scale.y = .062 * blink; });
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
    var outfit = material(THREE, cfg.outfitColor, .60, .06);
    var skin = material(THREE, cfg.skinColor, .76, .02);
    var accent = material(THREE, cfg.accentColor, .45, .15);
    var armPivots = {};
    [-1, 1].forEach(function (side) {
      var key = side < 0 ? 'left' : 'right';
      var pivot = new THREE.Group();
      pivot.position.set(side * .36, -.01, 0);
      pivot.rotation.z = side * -.11;
      group.add(pivot);
      mesh(THREE, new THREE.CylinderGeometry(.125, .105, .30, 16), outfit, pivot, key + '_sleeve', 0, -.15, 0);
      sphere(THREE, accent, pivot, key + '_cuff', 0, -.295, 0, .112, .048, .108);
      mesh(THREE, new THREE.CylinderGeometry(.080, .068, .26, 16), skin, pivot, key + '_forearm', 0, -.445, .010);
      sphere(THREE, skin, pivot, key + '_hand', 0, -.58, .038, .088, .100, .072);
      [-1, 0, 1].forEach(function (finger) {
        sphere(THREE, skin, pivot, key + '_finger', finger * .042, -.655, .065, .026, .060, .028);
      });
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
    var swing = Math.sin(t * 8.0) * walk * .14;
    group.position.y = -.07 + Math.abs(Math.sin(t * 4.0)) * (.014 + walk * .028);
    group.userData.armPivots.left.rotation.x = swing + Math.sin(t * 1.45) * .020;
    group.userData.armPivots.right.rotation.x = -swing + Math.sin(t * 1.45 + .3) * .020;
    var action = group.userData.actionStart ? (performance.now() - group.userData.actionStart) / 1000 : 99;
    if (action < .9) {
      var lift = Math.sin(Math.PI * clamp(action / .9, 0, 1));
      group.userData.armPivots.right.rotation.z = -1.05 * lift;
      group.userData.armPivots.right.rotation.x += Math.sin(action * 17) * .13 * lift;
    } else {
      group.userData.armPivots.right.rotation.z *= .80;
    }
  }

  function playFirstPersonAction(group) {
    if (group) group.userData.actionStart = performance.now();
  }

  window.TitanCharacterRuntime = {
    KEY: KEY,
    FORWARD_AXIS: '-Z',
    AVATAR_GEOMETRY: 'high-detail-lathe-humanoid',
    defaults: Object.assign({}, DEFAULTS),
    readCharacter: readCharacter,
    saveCharacter: saveCharacter,
    normalize: safeConfig,
    createModel: createModel,
    animateModel: animateModel,
    playAction: playAction,
    createFirstPersonArms: createFirstPersonArms,
    updateFirstPersonArms: updateFirstPersonArms,
    playFirstPersonAction: playFirstPersonAction
  };
})(window);
