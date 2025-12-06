"""Merge all origin codex/* branches into main using GitPython.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Dict

from git import Repo, GitCommandError

REPO_PATH = Path("/home/caspercaimeo/CaimeoV1")
REMOTE_NAME = "origin"
BASE_BRANCH = "main"
PUSH = False  # Set to True to push main after successful merges


def fetch_remote(repo: Repo) -> None:
    print(f"Fetching from {REMOTE_NAME}...")
    repo.remotes[REMOTE_NAME].fetch()


def get_codex_branches(repo: Repo) -> List[str]:
    branches = []
    prefix = f"{REMOTE_NAME}/codex/"
    for ref in repo.remotes[REMOTE_NAME].refs:
        name = ref.name
        if name.startswith(prefix):
            branches.append(name[len(f"{REMOTE_NAME}/") :])
    return sorted(branches)


def checkout_base(repo: Repo) -> None:
    repo.git.checkout(BASE_BRANCH)
    repo.git.pull(REMOTE_NAME, BASE_BRANCH)


def merge_branch(repo: Repo, branch: str, summary: Dict[str, List[str]]) -> None:
    target_ref = f"{REMOTE_NAME}/{branch}"
    print(f"\nMerging {target_ref} into {BASE_BRANCH}...")
    checkout_base(repo)

    try:
        repo.git.merge(target_ref)
    except GitCommandError as exc:
        message = str(exc)
        print(f"Merge failed for {branch}: {message}")
        if "CONFLICT" in message:
            try:
                repo.git.merge("--abort")
            except GitCommandError:
                print("Warning: merge --abort encountered an issue; repository state may need manual cleanup.")
            summary["conflicts"].append(branch)
        else:
            summary["errors"].append(branch)
        return

    if repo.is_dirty(index=True, working_tree=True, untracked_files=False):
        commit_message = f"Merge branch '{branch}' into '{BASE_BRANCH}'"
        repo.index.commit(commit_message)
        print(f"Committed merge: {commit_message}")
        if PUSH:
            try:
                repo.remote(REMOTE_NAME).push(BASE_BRANCH)
                print(f"Pushed {BASE_BRANCH} to {REMOTE_NAME} after merging {branch}.")
                summary["merged"].append(branch)
            except GitCommandError as exc:
                print(f"Push failed for {branch}: {exc}")
                summary["push_fail"].append(branch)
        else:
            summary["merged"].append(branch)
    else:
        print(f"{branch} is already up to date with {BASE_BRANCH}; no commit created.")
        summary["up_to_date"].append(branch)


def print_summary(summary: Dict[str, List[str]]) -> None:
    print("\nSummary:")
    print(f"  Merged: {', '.join(summary['merged']) or 'None'}")
    print(f"  Up to date: {', '.join(summary['up_to_date']) or 'None'}")
    print(f"  Conflicts: {', '.join(summary['conflicts']) or 'None'}")
    print(f"  Push errors: {', '.join(summary['push_fail']) or 'None'}")
    print(f"  Other errors: {', '.join(summary['errors']) or 'None'}")


def main() -> None:
    repo = Repo(REPO_PATH)
    fetch_remote(repo)
    codex_branches = get_codex_branches(repo)

    if not codex_branches:
        print("No codex/* branches found on remote; nothing to merge.")
        return

    summary: Dict[str, List[str]] = {
        "merged": [],
        "up_to_date": [],
        "conflicts": [],
        "push_fail": [],
        "errors": [],
    }

    for branch in codex_branches:
        merge_branch(repo, branch, summary)

    print_summary(summary)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Unexpected error: {exc}")
        sys.exit(1)
