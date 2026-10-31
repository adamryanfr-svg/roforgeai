// Serveur MCP « blender » de RoForge : pilote un Blender sans interface (modèles 3D low-poly,
// export FBX/OBJ pour Roblox, rendus d'aperçu). Blender est lancé au premier appel.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const BLENDER = process.env.ROFORGE_BLENDER_EXE || '';
const PORT = Number(process.env.ROFORGE_BLENDER_PORT || 44778);
const OUT_DIR = process.env.ROFORGE_PROJECT_DIR ? path.join(process.env.ROFORGE_PROJECT_DIR, 'modeles') : process.cwd();
const HOST_SCRIPT = path.join(__dirname, '..', '..', 'resources', 'blender', 'roforge_host.py');

let starting = null;

function request(payload, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, '127.0.0.1');
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Blender n’a pas répondu à temps'));
    }, timeoutMs);
    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.endsWith('\n')) {
        clearTimeout(timer);
        socket.end();
        resolve(JSON.parse(data));
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function ensureBlender() {
  try {
    return await request({ op: 'ping' }, 3000);
  } catch {
    // pas encore lancé
  }
  if (!BLENDER || !fs.existsSync(BLENDER)) {
    throw new Error('Blender n’est pas installé ou son chemin n’est pas réglé dans RoForge (Réglages › Blender).');
  }
  if (!starting) {
    starting = new Promise((resolve, reject) => {
      const child = spawn(BLENDER, ['-b', '--factory-startup', '--python', HOST_SCRIPT], {
        env: { ...process.env, ROFORGE_BLENDER_PORT: String(PORT) },
        windowsHide: true,
      });
      const timer = setTimeout(() => reject(new Error('Blender met trop de temps à démarrer')), 90000);
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('ROFORGE_BLENDER_READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on('exit', (code) => {
        starting = null;
        clearTimeout(timer);
        reject(new Error(`Blender s’est arrêté (code ${code})`));
      });
    });
  }
  await starting;
  return request({ op: 'ping' }, 5000);
}

async function python(code) {
  await ensureBlender();
  const reply = await request({ op: 'python', code });
  if (!reply.ok) throw new Error(`${reply.error}\n${reply.stdout || ''}`);
  return [reply.stdout, reply.result != null ? `result = ${reply.result}` : ''].filter(Boolean).join('\n') || 'OK';
}

function wrap(fn) {
  return async (args) => {
    try {
      return { content: [{ type: 'text', text: await fn(args) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true };
    }
  };
}

const py = (value) => JSON.stringify(value);
const server = new McpServer({ name: 'blender', version: '0.1.0' });

server.tool('blender_etat', 'Démarre Blender si besoin et renvoie sa version.', {}, wrap(async () => {
  const r = await ensureBlender();
  return `Blender ${r.version} prêt. Dossier d’export : ${OUT_DIR}`;
}));

server.tool(
  'blender_python',
  'Exécute du Python bpy dans Blender (scène persistante entre les appels). Assigne `result` pour renvoyer une valeur. Rendu pro comme les vrais jeux Roblox (jamais néon ni matériaux émissifs) : topologie propre, biseaux, matériaux PBR cohérents, nombre de polygones raisonnable pour Roblox, échelle 1 unité = 1 stud.',
  { code: z.string() },
  wrap((a) => python(a.code))
);

server.tool('blender_vider_scene', 'Supprime tous les objets de la scène.', {}, wrap(() =>
  python('import bpy\nbpy.ops.object.select_all(action="SELECT")\nbpy.ops.object.delete()\nresult = len(bpy.data.objects)')
));

server.tool(
  'blender_exporter',
  'Exporte la scène (ou les objets sélectionnés) en FBX ou OBJ dans le dossier modeles/ du jeu, prêt pour l’import Roblox.',
  { nom: z.string(), format: z.enum(['fbx', 'obj']).default('fbx'), selection_seulement: z.boolean().default(false) },
  wrap((a) => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${a.nom.replace(/[^\w\-]+/g, '_')}.${a.format}`);
    const code = a.format === 'fbx'
      ? `import bpy\nbpy.ops.export_scene.fbx(filepath=${py(file)}, use_selection=${a.selection_seulement ? 'True' : 'False'}, apply_scale_options='FBX_SCALE_UNITS', bake_space_transform=True)\nresult = ${py(file)}`
      : `import bpy\nbpy.ops.wm.obj_export(filepath=${py(file)}, export_selected_objects=${a.selection_seulement ? 'True' : 'False'}, export_materials=True)\nresult = ${py(file)}`;
    return python(code);
  })
);

server.tool(
  'blender_apercu',
  'Rend une image d’aperçu de la scène (PNG) dans modeles/, pour vérifier le modèle avec Read.',
  { nom: z.string().default('apercu'), angle: z.enum(['face', 'trois-quarts', 'dessus', 'cote']).default('trois-quarts') },
  wrap((a) => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${a.nom.replace(/[^\w\-]+/g, '_')}.png`);
    const angles = { face: [0, -1, 0.35], 'trois-quarts': [0.8, -0.8, 0.6], dessus: [0, -0.01, 1], cote: [1, 0, 0.35] };
    const [x, y, z2] = angles[a.angle];
    const code = `
import bpy, mathutils
scene = bpy.context.scene
objs = [o for o in scene.objects if o.type == 'MESH']
if not objs:
    raise Exception('Aucun maillage dans la scène')
mins = mathutils.Vector((1e9, 1e9, 1e9)); maxs = mathutils.Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mins = mathutils.Vector(map(min, mins, w)); maxs = mathutils.Vector(map(max, maxs, w))
center = (mins + maxs) / 2; size = max((maxs - mins).length, 0.1)
cam = bpy.data.objects.get('RoForgeCam') or bpy.data.objects.new('RoForgeCam', bpy.data.cameras.new('RoForgeCam'))
if cam.name not in scene.collection.objects: scene.collection.objects.link(cam)
cam.location = center + mathutils.Vector((${x}, ${y}, ${z2})).normalized() * size * 1.6
cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
if not any(o.type == 'LIGHT' for o in scene.objects):
    sun = bpy.data.objects.new('RoForgeSun', bpy.data.lights.new('RoForgeSun', 'SUN'))
    sun.rotation_euler = (0.8, 0.2, 0.6); scene.collection.objects.link(sun)
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scene.render.resolution_x = 768; scene.render.resolution_y = 768
scene.render.filepath = ${py(file)}
bpy.ops.render.render(write_still=True)
result = ${py(file)}`;
    return python(code);
  })
);

server.connect(new StdioServerTransport());
