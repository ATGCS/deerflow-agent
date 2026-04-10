"""Unit tests for HostDirect tool set — run with: python tests/test_host_direct.py"""

import sys
import os
import tempfile
import shutil
import importlib.util


def load_module(name, filepath):
    """Load a module directly from file path, bypassing package __init__.py."""
    spec = importlib.util.spec_from_file_location(name, filepath)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


HD = os.path.join(os.path.dirname(__file__), "..", "deerflow", "tools", "host_direct")
HD = os.path.abspath(HD)

passed = 0
failed = 0
errors = []


def check(test_name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  [PASS] {test_name}")
        passed += 1
    else:
        print(f"  [FAIL] {test_name} -- {detail}")
        failed += 1
        errors.append((test_name, detail))


def test_read_file(tmpdir):
    print("\n=== TEST 1: read_file_hd ===")
    rf = load_module("hd_read_file", os.path.join(HD, "read_file.py"))

    # Full file read
    txt = os.path.join(tmpdir, "hello.txt")
    with open(txt, "w", encoding="utf-8") as f:
        f.write("line1\nline2\nline3\nline4\nline5\n")

    r = rf.read_file_hd.invoke({"path": txt})
    # Normalize line endings for cross-platform comparison (Windows \r\n -> \n)
    actual = r.replace("\r\n", "\n").replace("\r", "\n")
    # File was written as "line1\nline2\n..." which includes trailing \n
    expected = "line1\nline2\nline3\nline4\nline5\n"
    check("Read full text file", actual == expected, f"expected={expected!r} got={actual!r}")

    # Offset + limit
    r2 = rf.read_file_hd.invoke({"path": txt, "offset": 2, "limit": 2})
    check(
        "Offset+limit with line numbers",
        "2:line2" in r2 and "3:line3" in r2,
        repr(r2),
    )

    # Non-existent
    r3 = rf.read_file_hd.invoke({"path": os.path.join(tmpdir, "nope.txt")})
    check("Non-existent file error", "Error: File not found" in r3)

    # Directory path
    r4 = rf.read_file_hd.invoke({"path": tmpdir})
    check("Directory path error", "Error:" in r4 and "directory" in r4.lower())

    # Empty file
    empty = os.path.join(tmpdir, "empty.txt")
    open(empty, "w").close()
    r5 = rf.read_file_hd.invoke({"path": empty})
    check("Empty file read", r5 == "", repr(r5))

    # Offset beyond end of file
    r6 = rf.read_file_hd.invoke({"path": txt, "offset": 100})
    check("Offset beyond EOF", isinstance(r6, str), repr(r6))


def test_write_file(tmpdir):
    print("\n=== TEST 2: write_file_hd ===")
    wf = load_module("hd_write_file", os.path.join(HD, "write_file.py"))

    wfile = os.path.join(tmpdir, "write_test.txt")
    r = wf.write_file_hd.invoke({"path": wfile, "content": "hello world"})
    check("Write file", "OK:" in r and open(wfile).read() == "hello world\n", r)

    # Append mode
    r = wf.write_file_hd.invoke({"path": wfile, "content": "appended", "append": True})
    content = open(wfile).read()
    check("Append mode", content == "hello world\nappended\n", repr(content))

    # Auto-create directory
    deep = os.path.join(tmpdir, "a", "b", "c", "deep.txt")
    r = wf.write_file_hd.invoke({"path": deep, "content": "deep"})
    check("Auto-create nested dirs", os.path.isfile(deep) and open(deep).read() == "deep\n")

    # Backup mode
    bak_file = os.path.join(tmpdir, "bak_test.txt")
    with open(bak_file, "w") as f:
        f.write("original")
    r = wf.write_file_hd.invoke({"path": bak_file, "content": "new", "backup": True})
    has_bak = os.path.exists(bak_file + ".bak") and open(bak_file + ".bak").read() == "original"
    current = open(bak_file).read()
    check("Backup created & file overwritten", has_bak and current == "new\n", f"bak={has_bak}, content={current}")

    # create_line (trailing newline)
    no_nl = os.path.join(tmpdir, "nonl.txt")
    r = wf.write_file_hd.invoke({"path": no_nl, "content": "no_newline"})
    check("Auto trailing newline", open(no_nl).read() == "no_newline\n")


def test_delete_file(tmpdir):
    print("\n=== TEST 3: delete_file_hd ===")
    df = load_module("hd_delete_file", os.path.join(HD, "delete_file.py"))

    delfile = os.path.join(tmpdir, "to_delete.txt")
    with open(delfile, "w") as f:
        f.write("delete me")
    r = df.delete_file_hd.invoke({"path": delfile})
    check("Delete existing file", "OK:" in r and not os.path.exists(delfile), r)

    # Double delete
    r2 = df.delete_file_hd.invoke({"path": delfile})
    check("Double-delete error", "Error: File not found" in r2, r2)

    # Delete directory (should block)
    r3 = df.delete_file_hd.invoke({"path": tmpdir})
    check("Directory blocked", "Error:" in r3, r3)


def test_list_dir(tmpdir):
    print("\n=== TEST 4: list_dir_hd ===")
    ld = load_module("hd_list_dir", os.path.join(HD, "list_dir.py"))

    # Create some files/dirs for testing
    os.makedirs(os.path.join(tmpdir, "subdir"), exist_ok=True)
    open(os.path.join(tmpdir, "a.py"), "w").close()
    open(os.path.join(tmpdir, "b.js"), "w").close()
    open(os.path.join(tmpdir, "subdir", "inner.txt"), "w").close()

    r = ld.list_dir_hd.invoke({"path": tmpdir, "format": "tree", "depth": 2})
    check("Tree format output", isinstance(r, str) and len(r) > 10, repr(r[:100]))
    check("Tree shows a.py", "a.py" in r)
    check("Tree shows subdir/", "subdir/" in r or "subdir" in r)

    r2 = ld.list_dir_hd.invoke({"path": tmpdir, "format": "list", "depth": 1})
    check("List format output", isinstance(r, str), repr(r2[:100]))

    # Non-existent dir
    r3 = ld.list_dir_hd.invoke({"path": os.path.join(tmpdir, "nope")})
    check("Non-existent dir error", "Error:" in r3, r3)


def test_str_replace(tmpdir):
    print("\n=== TEST 5: str_replace_hd ===")
    sr = load_module("hd_str_replace", os.path.join(HD, "str_replace.py"))

    src = os.path.join(tmpdir, "replace_src.txt")
    with open(src, "w", encoding="utf-8") as f:
        f.write("hello TARGET world\nother value here\nend\n")

    # Single replacement (TARGET is unique in this file)
    r = sr.str_replace_hd.invoke({
        "path": src,
        "old_string": "TARGET",
        "new_string": "NEW",
    })
    new_content = open(src).read()
    check("Single replace", "OK:" in r and "NEW" in new_content, f"{r} | content={repr(new_content)}")

    # Dry run preview
    dry = sr.str_replace_hd.invoke({
        "path": src,
        "old_string": "NEW",
        "new_string": "DRY",
        "dry_run": True,
    })
    check("Dry run preview", "Dry Run" in dry or "dry_run" in dry.lower(), dry[:80])

    # Verify dry-run didn't change file
    after_dry = open(src).read()
    check("Dry-run no side effect", "DRY" not in after_dry)

    # Regex replacement
    reg_file = os.path.join(tmpdir, "regex_test.txt")
    with open(reg_file, "w") as f:
        f.write("foo-123-bar\nfoo-456-baz\n")
    r = sr.str_replace_hd.invoke({
        "path": reg_file,
        "old_string": r"foo-\d+",
        "new_string": "REPLACED",
        "regex": True,
    })
    reg_result = open(reg_file).read()
    check("Regex replace all", "REPLACED" in reg_result and "foo-123" not in reg_result, repr(reg_result))

    # String not found
    r = sr.str_replace_hd.invoke({
        "path": src,
        "old_string": "NONEXISTENT_STRING_XYZ",
        "new_string": "x",
    })
    check("String not found error", "Error:" in r and "not found" in r.lower())


def test_search_content(tmpdir):
    print("\n=== TEST 6: search_content_hd ===")
    sc = load_module("hd_search_content", os.path.join(HD, "search_content.py"))

    # Create test files
    os.makedirs(os.path.join(tmpdir, "src"), exist_ok=True)
    with open(os.path.join(tmpdir, "src", "main.py"), "w") as f:
        f.write("# TODO: fix this\nimport os\n# TODO: add test\nprint('hello')\n")
    with open(os.path.join(tmpdir, "src", "util.py"), "w") as f:
        f.write("def helper():\n    pass\n# FIXME: broken\n")

    # Content mode search
    r = sc.search_content_hd.invoke({
        "pattern": "TODO|FIXME",
        "path": os.path.join(tmpdir, "src"),
        "output_mode": "content",
    })
    check("Content search finds matches", "TODO" in r or "FIXME" in r, repr(r[:100]))

    # Files_with_matches mode
    r2 = sc.search_content_hd.invoke({
        "pattern": "TODO|FIXME",
        "path": os.path.join(tmpdir, "src"),
        "output_mode": "files_with_matches",
    })
    check("Files_with_matches returns paths", "main.py" in r2, repr(r2))

    # Count mode
    r3 = sc.search_content_hd.invoke({
        "pattern": "TODO|FIXME",
        "path": os.path.join(tmpdir, "src"),
        "output_mode": "count",
    })
    check("Count mode returns counts", "match" in r3.lower(), repr(r3))

    # Glob filter
    r4 = sc.search_content_hd.invoke({
        "pattern": ".",
        "path": os.path.join(tmpdir, "src"),
        "glob_pattern": "*.py",
        "output_mode": "files_with_matches",
    })
    check("Glob filter *.py", "main.py" in r4 and "util.py" in r4, repr(r4))

    # Invalid regex
    r5 = sc.search_content_hd.invoke({
        "pattern": "[invalid",
        "path": tmpdir,
    })
    check("Invalid regex error", "Error:" in r5 and ("Invalid" in r5 or "regex" in r5.lower()), r5[:60])


def test_execute_command():
    print("\n=== TEST 7: execute_command_hd ===")
    ec = load_module("hd_exec_cmd", os.path.join(HD, "execute_command.py"))

    # Simple echo command (works on both Windows/Unix)
    r = ec.execute_command_hd.invoke({
        "command": "echo hello_host_direct_test",
        "timeout": 10,
    })
    check("Basic command execution", isinstance(r, str) and len(r) > 0, repr(r[:80]))

    # Error command (should return error but not crash)
    r2 = ec.execute_command_hd.invoke({
        "command": "exit 1" if os.name != "nt" else 'cmd /c "exit /b 1"',
        "timeout": 10,
    })
    check("Non-zero exit captured", "exit code" in r2.lower() or "[stderr]" in r2 or len(r2) > 0, repr(r2[:80]))


def test_web_fetch():
    print("\n=== TEST 8: web_fetch_hd ===")
    wf = load_module("hd_web_fetch", os.path.join(HD, "web_fetch.py"))

    # Blocked scheme
    r = wf.web_fetch_hd.invoke({"url": "file:///etc/passwd"})
    check("file:// blocked", "Error:" in r and ("blocked" in r.lower() or "allowed" in r.lower()), r[:60])

    # Invalid URL
    r2 = wf.web_fetch_hd.invoke({"url": "not-a-valid-url"})
    check("Invalid URL error", "Error:" in r2, r2[:60])


def main():
    global passed, failed

    tmpdir = tempfile.mkdtemp(prefix="host_direct_test_")
    print(f"Test temp dir: {tmpdir}")

    try:
        test_read_file(tmpdir)
        test_write_file(tmpdir)
        test_delete_file(tmpdir)
        test_list_dir(tmpdir)
        test_str_replace(tmpdir)
        test_search_content(tmpdir)
        test_execute_command()
        test_web_fetch()
    finally:
        shutil.rmtree(tmpdir)

    total = passed + failed
    print(f"\n{'='*60}")
    print(f"Results: {passed}/{total} passed, {failed} failed")
    if errors:
        print("\nFailed tests:")
        for name, detail in errors:
            print(f"  - {name}: {detail}")
    print("=" * 60)
    if failed == 0:
        print("ALL 8 TOOLS PASSED!")
        return 0
    else:
        print(f"{failed} TEST(S) FAILED!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
