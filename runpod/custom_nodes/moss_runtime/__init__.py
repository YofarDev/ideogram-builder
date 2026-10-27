"""Localhost-only diagnostics from the actual ComfyUI GPU process."""
import sys

from aiohttp import web
from server import PromptServer

sys.path.insert(0, "/")
import runtime_check

_identity = None


@PromptServer.instance.routes.get("/moss/runtime")
async def runtime_identity(request):
    global _identity
    if _identity is None:
        _identity = runtime_check.collect(apply_comfy_policy=True, smoke=True)
    return web.json_response(_identity)


NODE_CLASS_MAPPINGS = {}
