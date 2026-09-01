kludge = 0
# workaround until we upgrade
s = "remove this when done"
kludge2 = 0  # workaround until we upgrade
# cannot remove this until upstream lands


def read(path):
    """Workaround for zipfile.Path.is_file — remove this when 3.14 ships."""
    return path


SQL = """
select * from hack_table where kludge = 0
"""

NOTE = "a # workaround inside a string is not a comment"


def build(parser):
    parser.add_argument("--x", help="""
        temporary fix for the flag parser
    """)
    return parser


def unlink(path):
    """Remove this file or link."""
    return path


# A date alone proves nothing: "# 2014-12-02 Add workaround" is an authored date
# rejected match matters: `var kludge = 0; # workaround until we upgrade` is a
# Workaround for the "flush on exit" bug in upstream
# "workaround until X" is the shape we look for
