"""用户系统冒烟：需先启动服务。

    uv run python scripts/auth_smoke.py
覆盖：注册 / 无token 401(或403) / 坏token 401 / 带token /users/me /
重复注册 409 / 登录 / 错密码 401 / refresh / PATCH /users/me。
"""
import os
import uuid

import httpx

BASE = f"http://127.0.0.1:{os.environ.get('MORNING_PORT', '8000')}/api/v1"


def main() -> None:
    u = f"tester_{uuid.uuid4().hex[:8]}"
    pw = "secret123"
    with httpx.Client(timeout=30) as c:
        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": pw})
        print("[register]", r.status_code)
        assert r.status_code == 201, r.text
        access = r.json()["access_token"]
        refresh = r.json()["refresh_token"]

        r = c.get(f"{BASE}/users/me")
        print("[me no-token]", r.status_code)
        assert r.status_code in (401, 403)

        r = c.get(f"{BASE}/users/me", headers={"Authorization": "Bearer garbage.token.here"})
        print("[me bad-token]", r.status_code)
        assert r.status_code == 401

        r = c.get(f"{BASE}/users/me", headers={"Authorization": f"Bearer {access}"})
        print("[me ok]", r.status_code, r.json())
        assert r.status_code == 200 and r.json()["username"] == u

        r = c.post(f"{BASE}/auth/register", json={"username": u, "password": pw})
        print("[dup register]", r.status_code)
        assert r.status_code == 409

        r = c.post(f"{BASE}/auth/login", json={"username": u, "password": pw})
        print("[login]", r.status_code)
        assert r.status_code == 200

        r = c.post(f"{BASE}/auth/login", json={"username": u, "password": "wrong"})
        print("[login wrong-pw]", r.status_code)
        assert r.status_code == 401

        r = c.post(f"{BASE}/auth/refresh", json={"refresh_token": refresh})
        print("[refresh]", r.status_code)
        assert r.status_code == 200

        r = c.patch(
            f"{BASE}/users/me",
            headers={"Authorization": f"Bearer {access}"},
            json={"display_name": "晨熠"},
        )
        print("[patch me]", r.status_code, "display_name =", r.json().get("display_name"))
        assert r.status_code == 200 and r.json()["display_name"] == "晨熠"

    print("\nALL AUTH SMOKE PASSED ✅")


if __name__ == "__main__":
    main()
