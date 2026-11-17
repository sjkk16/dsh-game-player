/** Pinned 0.2.2 tool shapes; descriptions may explain newer disabled behavior. */
export default [
  {
    "name": "game_screen",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "target": {
          "type": "string",
          "enum": [
            "window",
            "primary",
            "virtual"
          ]
        },
        "region": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "x",
            "y",
            "width",
            "height"
          ],
          "properties": {
            "x": {
              "type": "integer"
            },
            "y": {
              "type": "integer"
            },
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            }
          }
        },
        "monitor": {
          "type": "string",
          "enum": [
            "primary",
            "virtual"
          ]
        },
        "maxWidth": {
          "type": "integer"
        },
        "quality": {
          "type": "integer"
        },
        "force": {
          "type": "boolean"
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "width",
        "height",
        "screenWidth",
        "screenHeight",
        "screenX",
        "screenY",
        "scale",
        "diff",
        "changed",
        "attached",
        "cursorX",
        "cursorY"
      ],
      "properties": {
        "width": {
          "type": "integer"
        },
        "height": {
          "type": "integer"
        },
        "screenWidth": {
          "type": "integer"
        },
        "screenHeight": {
          "type": "integer"
        },
        "screenX": {
          "type": "integer"
        },
        "screenY": {
          "type": "integer"
        },
        "scale": {
          "type": "number"
        },
        "diff": {
          "type": "number"
        },
        "changed": {
          "type": "boolean"
        },
        "attached": {
          "type": "boolean"
        },
        "cursorX": {
          "type": "integer"
        },
        "cursorY": {
          "type": "integer"
        },
        "foreground": {
          "type": "string"
        },
        "warning": {
          "type": "string"
        },
        "image": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "attachmentId",
            "mediaType",
            "bytes",
            "width",
            "height"
          ],
          "properties": {
            "attachmentId": {
              "type": "string"
            },
            "mediaType": {
              "type": "string",
              "enum": [
                "image/jpeg",
                "image/png"
              ]
            },
            "bytes": {
              "type": "integer"
            },
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            },
            "name": {
              "type": "string"
            }
          }
        }
      }
    },
    "concurrencySafe": true
  },
  {
    "name": "game_input",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "macro": {
          "type": "string"
        },
        "revision": {
          "type": "string"
        },
        "repeat": {
          "type": "integer"
        },
        "coordinateSpace": {
          "type": "string",
          "enum": [
            "screen",
            "client"
          ]
        },
        "durationMs": {
          "type": "integer"
        },
        "kind": {
          "type": "string",
          "enum": [
            "move",
            "click",
            "down",
            "up",
            "scroll",
            "key",
            "keydown",
            "keyup",
            "hold",
            "type",
            "drag",
            "wait"
          ]
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "move",
                  "click",
                  "down",
                  "up",
                  "scroll",
                  "key",
                  "keydown",
                  "keyup",
                  "hold",
                  "type",
                  "drag",
                  "wait"
                ]
              },
              "x": {
                "type": "integer"
              },
              "y": {
                "type": "integer"
              },
              "button": {
                "type": "string",
                "enum": [
                  "left",
                  "right",
                  "middle"
                ]
              },
              "count": {
                "type": "integer"
              },
              "keys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "text": {
                "type": "string"
              },
              "amount": {
                "type": "integer"
              },
              "durationMs": {
                "type": "integer"
              },
              "holdMs": {
                "type": "integer"
              },
              "fromX": {
                "type": "integer"
              },
              "fromY": {
                "type": "integer"
              },
              "steps": {
                "type": "integer"
              }
            }
          }
        },
        "x": {
          "type": "integer"
        },
        "y": {
          "type": "integer"
        },
        "button": {
          "type": "string",
          "enum": [
            "left",
            "right",
            "middle"
          ]
        },
        "count": {
          "type": "integer"
        },
        "keys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "text": {
          "type": "string"
        },
        "amount": {
          "type": "integer"
        },
        "holdMs": {
          "type": "integer"
        },
        "fromX": {
          "type": "integer"
        },
        "fromY": {
          "type": "integer"
        },
        "steps": {
          "type": "integer"
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "ok",
        "actions",
        "cursorX",
        "cursorY"
      ],
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "cursorX": {
          "type": "integer"
        },
        "cursorY": {
          "type": "integer"
        },
        "heldKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "heldButtons": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "dryRun": {
          "type": "boolean"
        }
      }
    },
    "concurrencySafe": false
  },
  {
    "name": "game_watch",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "start",
            "stop",
            "status"
          ]
        },
        "target": {
          "type": "string",
          "enum": [
            "window",
            "primary",
            "virtual"
          ]
        },
        "region": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "x",
            "y",
            "width",
            "height"
          ],
          "properties": {
            "x": {
              "type": "integer"
            },
            "y": {
              "type": "integer"
            },
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            }
          }
        },
        "intervalMs": {
          "type": "integer"
        },
        "threshold": {
          "type": "number"
        },
        "maxWakes": {
          "type": "integer"
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "running",
        "intervalMs",
        "threshold",
        "wakes",
        "maxWakes"
      ],
      "properties": {
        "running": {
          "type": "boolean"
        },
        "intervalMs": {
          "type": "integer"
        },
        "threshold": {
          "type": "number"
        },
        "wakes": {
          "type": "integer"
        },
        "maxWakes": {
          "type": "integer"
        },
        "lastError": {
          "type": "string"
        }
      }
    },
    "concurrencySafe": true
  },
  {
    "name": "game_window",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "list",
            "bind",
            "status",
            "unbind"
          ]
        },
        "windowId": {
          "type": "string"
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "windows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "windowId",
              "title",
              "pid",
              "processStart",
              "valid",
              "focused",
              "minimized",
              "client"
            ],
            "properties": {
              "windowId": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "pid": {
                "type": "integer"
              },
              "processStart": {
                "type": "string"
              },
              "valid": {
                "type": "boolean"
              },
              "focused": {
                "type": "boolean"
              },
              "minimized": {
                "type": "boolean"
              },
              "client": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "x",
                  "y",
                  "width",
                  "height"
                ],
                "properties": {
                  "x": {
                    "type": "integer"
                  },
                  "y": {
                    "type": "integer"
                  },
                  "width": {
                    "type": "integer"
                  },
                  "height": {
                    "type": "integer"
                  }
                }
              }
            }
          }
        },
        "bound": {
          "type": "boolean"
        },
        "inputLocked": {
          "type": "boolean"
        },
        "windowId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "pid": {
          "type": "integer"
        },
        "processStart": {
          "type": "string"
        },
        "valid": {
          "type": "boolean"
        },
        "focused": {
          "type": "boolean"
        },
        "minimized": {
          "type": "boolean"
        },
        "client": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "x",
            "y",
            "width",
            "height"
          ],
          "properties": {
            "x": {
              "type": "integer"
            },
            "y": {
              "type": "integer"
            },
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            }
          }
        },
        "lastError": {
          "type": "string"
        }
      }
    },
    "concurrencySafe": false
  },
  {
    "name": "game_macro",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "list",
            "get",
            "save",
            "delete"
          ]
        },
        "name": {
          "type": "string"
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "move",
                  "click",
                  "down",
                  "up",
                  "scroll",
                  "key",
                  "keydown",
                  "keyup",
                  "hold",
                  "type",
                  "drag",
                  "wait"
                ]
              },
              "x": {
                "type": "integer"
              },
              "y": {
                "type": "integer"
              },
              "button": {
                "type": "string",
                "enum": [
                  "left",
                  "right",
                  "middle"
                ]
              },
              "count": {
                "type": "integer"
              },
              "keys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "text": {
                "type": "string"
              },
              "amount": {
                "type": "integer"
              },
              "durationMs": {
                "type": "integer"
              },
              "holdMs": {
                "type": "integer"
              },
              "fromX": {
                "type": "integer"
              },
              "fromY": {
                "type": "integer"
              },
              "steps": {
                "type": "integer"
              }
            }
          }
        },
        "expectedRevision": {
          "type": "string"
        }
      }
    },
    "outputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "templates": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "name",
              "revision"
            ],
            "properties": {
              "name": {
                "type": "string"
              },
              "revision": {
                "type": "string"
              },
              "referenceSize": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "width",
                  "height"
                ],
                "properties": {
                  "width": {
                    "type": "integer"
                  },
                  "height": {
                    "type": "integer"
                  }
                }
              }
            }
          }
        },
        "name": {
          "type": "string"
        },
        "revision": {
          "type": "string"
        },
        "referenceSize": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "width",
            "height"
          ],
          "properties": {
            "width": {
              "type": "integer"
            },
            "height": {
              "type": "integer"
            }
          }
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind"
            ],
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "move",
                  "click",
                  "down",
                  "up",
                  "scroll",
                  "key",
                  "keydown",
                  "keyup",
                  "hold",
                  "type",
                  "drag",
                  "wait"
                ]
              },
              "x": {
                "type": "integer"
              },
              "y": {
                "type": "integer"
              },
              "button": {
                "type": "string",
                "enum": [
                  "left",
                  "right",
                  "middle"
                ]
              },
              "count": {
                "type": "integer"
              },
              "keys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "text": {
                "type": "string"
              },
              "amount": {
                "type": "integer"
              },
              "durationMs": {
                "type": "integer"
              },
              "holdMs": {
                "type": "integer"
              },
              "fromX": {
                "type": "integer"
              },
              "fromY": {
                "type": "integer"
              },
              "steps": {
                "type": "integer"
              }
            }
          }
        },
        "deleted": {
          "type": "boolean"
        }
      }
    },
    "concurrencySafe": false
  }
]
