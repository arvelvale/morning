"""模型切换离线回归：默认值/环境覆盖/工厂/AI 网关请求，绝不调用供应商。"""
import asyncio
import os
from unittest.mock import patch

import httpx

from app.config import Settings
from app.llm import get_chat_model
from app.stepfun import client


def main():
    with patch.dict(os.environ, {}, clear=True):
        settings = Settings(_env_file=None, stepfun_api_key="test-unused")
        assert settings.step_text_model == "step-3.7-flash"
        assert settings.step_tts_model == "stepaudio-2.5-tts"
        assert settings.step_realtime_model == "stepaudio-2.5-realtime"
        assert settings.step_image_model == "step-image-edit-2"
    with patch.dict(os.environ, {"STEP_TEXT_MODEL": "test-explicit-model"}):
        assert Settings(_env_file=None).step_text_model == "test-explicit-model"
    with patch("app.llm.get_settings", return_value=settings):
        assert get_chat_model().model_name == "step-3.7-flash"
        assert get_chat_model("test-explicit-model").model_name == "test-explicit-model"

    seen = []
    def handler(request):
        import json
        payload = json.loads(request.content)
        seen.append(payload)
        if payload["stream"]:
            return httpx.Response(200, text='data: {"choices":[]}\n\ndata: [DONE]\n\n')
        return httpx.Response(200, json={"model": payload["model"], "choices": []})

    async_client = httpx.AsyncClient
    def isolated_client(**kwargs):
        return async_client(transport=httpx.MockTransport(handler), **kwargs)

    async def check_gateway():
        with patch("app.stepfun.client.get_settings", return_value=settings), patch("app.stepfun.client.httpx.AsyncClient", side_effect=isolated_client):
            await client.chat_completion({"messages": [{"role": "user", "content": "你好"}]})
            chunks = [chunk async for chunk in client.chat_stream({"messages": [{"role": "user", "content": "你好"}]})]
            assert chunks[-1] == "[DONE]"
            await client.chat_completion({"model": "test-explicit-model", "messages": []})
    asyncio.run(check_gateway())
    assert [p["model"] for p in seen] == ["step-3.7-flash", "step-3.7-flash", "test-explicit-model"]
    assert [p["stream"] for p in seen] == [False, True, False]
    print("PASS model config: default/env override/LangChain/gateway streaming+non-streaming; voice/image-generation unchanged")


if __name__ == "__main__":
    main()
