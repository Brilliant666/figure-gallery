#!/usr/bin/env python
"""Management entry point for the disposable Wagtail proof of concept."""

import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "figure_gallery_poc.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
