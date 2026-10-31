"""Hôte Blender sans interface pour RoForge.

Lancé par le MCP Blender de RoForge : blender -b --factory-startup --python roforge_host.py
Écoute en local (ROFORGE_BLENDER_PORT) des requêtes JSON d'une ligne :
  {"op": "python", "code": "..."}   exécute du Python bpy, renvoie stdout + variable `result`
  {"op": "ping"}
La boucle tourne dans le thread principal de Blender (obligatoire pour bpy en mode -b).
"""
import contextlib
import io
import json
import os
import socket
import traceback

import bpy  # noqa: F401  (disponible pour le code exécuté)

PORT = int(os.environ.get("ROFORGE_BLENDER_PORT", "44778"))
namespace = {"bpy": bpy}


def handle(request):
    op = request.get("op")
    if op == "ping":
        return {"ok": True, "version": bpy.app.version_string}
    if op == "python":
        out = io.StringIO()
        namespace.pop("result", None)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
                exec(compile(request["code"], "<roforge>", "exec"), namespace)
            result = namespace.get("result")
            return {"ok": True, "stdout": out.getvalue()[-20000:], "result": repr(result) if result is not None else None}
        except Exception:
            return {"ok": False, "stdout": out.getvalue()[-20000:], "error": traceback.format_exc()[-8000:]}
    if op == "quit":
        return {"ok": True, "quit": True}
    return {"ok": False, "error": "op inconnue: %s" % op}


def serve():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", PORT))
    server.listen(4)
    print("ROFORGE_BLENDER_READY %d" % PORT, flush=True)
    while True:
        conn, _ = server.accept()
        with conn:
            buffer = b""
            while not buffer.endswith(b"\n"):
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buffer += chunk
            if not buffer.strip():
                continue
            try:
                reply = handle(json.loads(buffer.decode("utf-8")))
            except Exception:
                reply = {"ok": False, "error": traceback.format_exc()}
            conn.sendall((json.dumps(reply) + "\n").encode("utf-8"))
            if reply.get("quit"):
                break


serve()
