from django.core.management.base import BaseCommand, CommandError

from gallery.exports import write_csv_export, write_json_export


class Command(BaseCommand):
    help = "Export open relational JSON or CSV without media binaries."

    def add_arguments(self, parser):
        parser.add_argument("--format", choices=["json", "csv"], required=True)
        parser.add_argument("--output", required=True)

    def handle(self, *args, **options):
        try:
            if options["format"] == "json":
                files = write_json_export(options["output"])
            else:
                files = write_csv_export(options["output"])
        except OSError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(f"wrote {len(files)} export file(s)"))
