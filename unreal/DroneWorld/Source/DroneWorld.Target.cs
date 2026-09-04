using UnrealBuildTool;
using System.Collections.Generic;

public class DroneWorldTarget : TargetRules
{
    public DroneWorldTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        ExtraModuleNames.Add("DroneWorld");
    }
}
