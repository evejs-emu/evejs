const protobuf = require("protobufjs");

function buildSkillPlanProtoRoot() {
  return protobuf.Root.fromJSON({
    nested: {
      eve_public: {
        nested: {
          inventory: {
            nested: {
              genericitemtype: {
                nested: {
                  Identifier: {
                    fields: {
                      sequential: { type: "uint32", id: 1 },
                    },
                  },
                },
              },
            },
          },
          skilltype: {
            nested: {
              Identifier: {
                fields: {
                  sequential: { type: "uint32", id: 1 },
                },
              },
            },
          },
          skill: {
            nested: {
              plan: {
                nested: {
                  Identifier: {
                    fields: {
                      uuid: { type: "bytes", id: 1 },
                    },
                  },
                  Attributes: {
                    fields: {
                      name: { type: "string", id: 1 },
                      skill_requirements: {
                        rule: "repeated",
                        type: "eve_public.skill.plan.SkillRequirement",
                        id: 2,
                      },
                      description: { type: "string", id: 3 },
                    },
                  },
                  SkillRequirement: {
                    fields: {
                      skill_type: {
                        type: "eve_public.skilltype.Identifier",
                        id: 1,
                      },
                      level: { type: "uint32", id: 2 },
                    },
                  },
                  milestone: {
                    nested: {
                      Identifier: {
                        fields: {
                          uuid: { type: "bytes", id: 1 },
                        },
                      },
                      Attributes: {
                        oneofs: {
                          milestone: {
                            oneof: ["train_to_type", "skill"],
                          },
                        },
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                          train_to_type: {
                            type: "eve_public.inventory.genericitemtype.Identifier",
                            id: 2,
                          },
                          skill: {
                            type: "eve_public.skill.plan.SkillRequirement",
                            id: 3,
                          },
                          description: { type: "string", id: 4 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          character: {
            nested: {
              skill: {
                nested: {
                  plan: {
                    nested: {
                      GetAllRequest: { fields: {} },
                      GetAllResponse: {
                        fields: {
                          skill_plans: {
                            rule: "repeated",
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      GetRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      GetResponse: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Attributes",
                            id: 1,
                          },
                        },
                      },
                      GetSharedRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      GetSharedResponse: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Attributes",
                            id: 1,
                          },
                        },
                      },
                      CreateRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Attributes",
                            id: 1,
                          },
                        },
                      },
                      CreateResponse: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      SetSkillRequirementsRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                          requirements: {
                            rule: "repeated",
                            type: "eve_public.skill.plan.SkillRequirement",
                            id: 2,
                          },
                        },
                      },
                      SetSkillRequirementsResponse: { fields: {} },
                      SetNameRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                          name: { type: "string", id: 2 },
                        },
                      },
                      SetNameResponse: { fields: {} },
                      SetDescriptionRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                          description: { type: "string", id: 2 },
                        },
                      },
                      SetDescriptionResponse: { fields: {} },
                      DeleteRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      DeleteResponse: { fields: {} },
                      GetActiveRequest: { fields: {} },
                      GetActiveResponse: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                          skill_plan_info: {
                            type: "eve_public.skill.plan.Attributes",
                            id: 2,
                          },
                        },
                      },
                      SetActiveRequest: {
                        fields: {
                          skill_plan: {
                            type: "eve_public.skill.plan.Identifier",
                            id: 1,
                          },
                        },
                      },
                      SetActiveResponse: { fields: {} },
                      milestone: {
                        nested: {
                          GetAllRequest: {
                            fields: {
                              skill_plan: {
                                type: "eve_public.skill.plan.Identifier",
                                id: 1,
                              },
                            },
                          },
                          GetAllResponse: {
                            fields: {
                              milestones: {
                                rule: "repeated",
                                type:
                                  "eve_public.character.skill.plan.milestone.GetAllResponse.Milestone",
                                id: 1,
                              },
                            },
                            nested: {
                              Milestone: {
                                fields: {
                                  identifier: {
                                    type: "eve_public.skill.plan.milestone.Identifier",
                                    id: 1,
                                  },
                                  data: {
                                    type: "eve_public.skill.plan.milestone.Attributes",
                                    id: 2,
                                  },
                                },
                              },
                            },
                          },
                          CreateRequest: {
                            fields: {
                              milestone: {
                                type: "eve_public.skill.plan.milestone.Attributes",
                                id: 1,
                              },
                            },
                          },
                          CreateResponse: {
                            fields: {
                              milestone: {
                                type: "eve_public.skill.plan.milestone.Identifier",
                                id: 1,
                              },
                            },
                          },
                          DeleteRequest: {
                            fields: {
                              milestone: {
                                type: "eve_public.skill.plan.milestone.Identifier",
                                id: 1,
                              },
                            },
                          },
                          DeleteResponse: { fields: {} },
                          SetDescriptionRequest: {
                            fields: {
                              identifier: {
                                type: "eve_public.skill.plan.milestone.Identifier",
                                id: 1,
                              },
                              description: { type: "string", id: 2 },
                            },
                          },
                          SetDescriptionResponse: { fields: {} },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

module.exports = {
  buildSkillPlanProtoRoot,
};
