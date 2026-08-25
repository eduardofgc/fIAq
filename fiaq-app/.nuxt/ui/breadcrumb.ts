const color = [
  "primary",
  "secondary",
  "success",
  "info",
  "warning",
  "error",
  "neutral"
] as const

export default {
  "slots": {
    "root": "relative min-w-0",
    "list": "flex items-center gap-1.5",
    "item": "flex min-w-0",
    "link": "group relative flex items-center gap-1.5 text-sm min-w-0",
    "linkLeadingIcon": "shrink-0 size-5",
    "linkLeadingAvatar": "shrink-0",
    "linkLeadingAvatarSize": "2xs",
    "linkLabel": "truncate",
    "separator": "flex",
    "separatorIcon": "shrink-0 size-5 text-muted"
  },
  "variants": {
    "active": {
      "true": {
        "link": "font-semibold"
      },
      "false": {
        "link": "text-muted font-medium"
      }
    },
    "disabled": {
      "true": {
        "link": "cursor-not-allowed opacity-75"
      }
    },
    "to": {
      "true": ""
    },
    "color": {
      "primary": {
        "link": "focus-visible:outline-primary"
      },
      "secondary": {
        "link": "focus-visible:outline-secondary"
      },
      "success": {
        "link": "focus-visible:outline-success"
      },
      "info": {
        "link": "focus-visible:outline-info"
      },
      "warning": {
        "link": "focus-visible:outline-warning"
      },
      "error": {
        "link": "focus-visible:outline-error"
      },
      "neutral": {
        "link": "focus-visible:outline-inverted"
      }
    }
  },
  "compoundVariants": [
    {
      "disabled": false,
      "active": false,
      "to": true,
      "class": {
        "link": [
          "hover:text-default",
          "transition-colors"
        ]
      }
    },
    {
      "color": "primary" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-primary"
      }
    },
    {
      "color": "secondary" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-secondary"
      }
    },
    {
      "color": "success" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-success"
      }
    },
    {
      "color": "info" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-info"
      }
    },
    {
      "color": "warning" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-warning"
      }
    },
    {
      "color": "error" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-error"
      }
    },
    {
      "color": "neutral" as typeof color[number],
      "active": true,
      "class": {
        "link": "text-highlighted"
      }
    }
  ],
  "defaultVariants": {
    "color": "primary" as typeof color[number]
  }
}