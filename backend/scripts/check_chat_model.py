"""检查当前模型配置；--live 才调用供应商（不访问业务数据库、不写线上数据）。"""
import argparse
import base64
import io
import json
import sys

from langchain_core.messages import HumanMessage
from PIL import Image, ImageDraw

from app.config import get_settings
from app.llm import get_chat_model


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="实际测试文字流式、JSON 输出和图片理解，会消耗模型额度")
    parser.add_argument("--model", help="核验候选模型，不修改当前配置")
    args = parser.parse_args()
    settings = get_settings()
    name = args.model or settings.step_text_model
    print(f"model={name}; endpoint={settings.stepfun_base_url}; key_loaded={bool(settings.stepfun_api_key)}")
    if not args.live:
        return 0
    if not settings.stepfun_api_key:
        print("FAIL: 未配置供应商凭据")
        return 1
    # 缩短测试等待，不沿用线上五次重试；仅在测试里限定输出与推理预算。
    model = get_chat_model(name, max_retries=0, timeout=45, max_tokens=2048, reasoning_effort="low")
    try:
        streamed = "".join(c.content for c in model.stream([HumanMessage(content="请只回复：你好")]) if isinstance(c.content, str))
        if "你好" not in streamed:
            raise AssertionError("文字流式没有返回预期内容")
        print("PASS text_stream: 收到文字增量")

        structured = model.invoke([HumanMessage(content='只返回合法 JSON，不要 Markdown：{"ok":true,"items":[]}')])
        raw = str(structured.content).strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(raw)
        if data != {"ok": True, "items": []}:
            raise AssertionError("JSON 输出不符合预期")
        reported_model = structured.response_metadata.get("model_name", "未报告")
        print(f"PASS structured_json: 返回合法 JSON; provider_model={reported_model}")

        # 本地生成无隐私测试图；不上传用户截图、照片或业务资料。
        image = Image.new("RGB", (256, 256), "white")
        ImageDraw.Draw(image).rectangle((32, 32, 224, 224), fill="red")
        output = io.BytesIO()
        image.save(output, format="PNG")
        url = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
        answer = model.invoke([HumanMessage(content=[
            {"type": "text", "text": "图中央的大色块是什么颜色？只回答颜色名称。"},
            {"type": "image_url", "image_url": {"url": url}},
        ])])
        text = str(answer.content)
        if "红" not in text and "red" not in text.lower():
            raise AssertionError("图片理解未识别合成图的红色色块")
        print("PASS image_input: 正确识别合成图的红色色块")
    except Exception as exc:
        # 不回显原始响应/请求头：SDK 异常可能含请求细节或凭据。
        code = getattr(exc, "status_code", None)
        print(f"FAIL: {type(exc).__name__}; http_status={code}; 检查模型权限、通道和供应商状态")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
