"""把停写后取得的 SQLite 备份复制到一个专用、空的 PostgreSQL 数据库。

默认只审计源库；--copy 需要 MORNING_PG_MIGRATE_URL 环境变量。
目标库必须没有任何现存表。本脚本保留主键和 JSON，重置自增序列，复制完成后 stamp 当前 Alembic head。
若复制失败，目标库可能留下空表，但数据事务会回滚；重试前请先清理该专用测试库。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Column, MetaData, String, Table, create_engine, func, inspect, insert, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.sql.sqltypes import DateTime

from app.db import Base
import app.models  # noqa: F401  注册全部 ORM 模型


def audit(source_path: Path):
    if not source_path.is_file():
        raise ValueError("源 SQLite 备份文件不存在")
    source = create_engine("sqlite://", creator=lambda: sqlite3.connect(
        f"file:{source_path.as_posix()}?mode=ro", uri=True))
    with source.connect() as conn:
        source_names = set(inspect(conn).get_table_names()) - {"alembic_version"}
        known_names = set(Base.metadata.tables)
        extra = sorted(source_names - known_names)
        if extra:
            raise ValueError(f"源库有模型外的表，请先确认归属：{', '.join(extra)}")
        if not source_names:
            raise ValueError("源库没有业务表")
        counts = {}
        for table in Base.metadata.sorted_tables:
            if table.name in source_names:
                actual = {c["name"] for c in inspect(conn).get_columns(table.name)}
                extra_columns = actual - set(table.columns.keys())
                if extra_columns:
                    raise ValueError(f"{table.name} 存在模型外字段：{', '.join(sorted(extra_columns))}")
                counts[table.name] = conn.scalar(select(func.count()).select_from(table))
        print(f"源库：{len(counts)} 张表，共 {sum(counts.values())} 行")
        for name, count in counts.items():
            print(f"  {name}: {count}")
    return source, source_names, counts


def _canonical(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex()
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    return value


def verify_rows(old, new, source_names):
    """按主键顺序比较每一行的公共字段内容，而不只比较数量。"""
    for table in Base.metadata.sorted_tables:
        if table.name not in source_names:
            continue
        actual = {column["name"] for column in inspect(old).get_columns(table.name)}
        columns = [column for column in table.columns if column.name in actual]
        stmt = select(*columns).order_by(*table.primary_key.columns)
        digests = []
        for conn in (old, new):
            digest = hashlib.sha256()
            for row in conn.execute(stmt):
                payload = json.dumps(
                    [_canonical(value) for value in row],
                    ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                ).encode("utf-8")
                digest.update(len(payload).to_bytes(8, "big"))
                digest.update(payload)
            digests.append(digest.digest())
        if digests[0] != digests[1]:
            raise ValueError(f"{table.name} 逐行内容校验失败")
    print("逐表逐行内容摘要校验通过")


def copy(source, source_names, counts, target_url: str):
    url = make_url(target_url)
    if url.get_backend_name() != "postgresql":
        raise ValueError("目标必须是 PostgreSQL URL")
    target = create_engine(url, pool_pre_ping=True)
    try:
        with target.connect() as conn:
            existing = inspect(conn).get_table_names()
            if existing:
                raise ValueError("目标库已有表，请使用专用空库；不会覆盖现有库")
        Base.metadata.create_all(target)
        head = ScriptDirectory.from_config(Config(str(Path(__file__).parents[1] / "alembic.ini"))).get_current_head()
        with source.connect() as old, target.begin() as new:
            for table in Base.metadata.sorted_tables:
                if table.name not in source_names:
                    continue
                actual = {c["name"] for c in inspect(old).get_columns(table.name)}
                columns = [c for c in table.columns if c.name in actual]
                cursor = old.execute(select(*columns))
                copied = 0
                while batch := cursor.fetchmany(500):
                    records = []
                    for row in batch:
                        record = dict(row._mapping)
                        for column in columns:
                            value = record[column.name]
                            if isinstance(column.type, DateTime) and column.type.timezone and isinstance(value, datetime) and value.tzinfo is None:
                                record[column.name] = value.replace(tzinfo=timezone.utc)
                        records.append(record)
                    new.execute(insert(table), records)
                    copied += len(records)
                if copied != counts[table.name] or new.scalar(select(func.count()).select_from(table)) != copied:
                    raise ValueError(f"{table.name} 行数核对失败，迁移事务将回滚")
                for column in table.primary_key.columns:
                    if not column.autoincrement or not copied:
                        continue
                    quoted_column = new.dialect.identifier_preparer.quote(column.name)
                    sequence = new.scalar(text("SELECT pg_get_serial_sequence(:tbl, :col)"), {"tbl": table.name, "col": column.name})
                    if sequence:
                        max_id = new.scalar(text(f"SELECT MAX({quoted_column}) FROM {new.dialect.identifier_preparer.quote(table.name)}"))
                        new.execute(text("SELECT setval(CAST(:seq AS regclass), :value, true)"), {"seq": sequence, "value": max_id})
            verify_rows(old, new, source_names)
            # PostgreSQL DDL 与复制数据同事务提交；失败不留下已迁完标记。
            version = Table("alembic_version", MetaData(), Column("version_num", String(32), primary_key=True))
            version.create(new)
            new.execute(insert(version).values(version_num=head))
        print(f"目标库逐表行数已核对，Alembic 版本：{head}")
    finally:
        target.dispose()


def verify_existing(source, source_names, target_url):
    url = make_url(target_url)
    if url.get_backend_name() != "postgresql":
        raise ValueError("目标必须是 PostgreSQL URL")
    target = create_engine(url, pool_pre_ping=True)
    try:
        with source.connect() as old, target.connect() as new:
            verify_rows(old, new, source_names)
    finally:
        target.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="停写后取得的 SQLite 一致性备份文件")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--copy", action="store_true", help="向环境变量指定的专用空 PostgreSQL 库写入")
    action.add_argument("--verify", action="store_true", help="只读比较源库与已复制目标库的内容")
    args = parser.parse_args()
    source, names, counts = audit(args.source.resolve())
    try:
        if args.copy or args.verify:
            target_url = os.environ.get("MORNING_PG_MIGRATE_URL")
            if not target_url:
                raise ValueError("缺少 MORNING_PG_MIGRATE_URL")
            if args.copy:
                copy(source, names, counts, target_url)
            else:
                verify_existing(source, names, target_url)
        else:
            print("只读审计完成；使用 --copy 才会写目标库")
    finally:
        source.dispose()


if __name__ == "__main__":
    main()
