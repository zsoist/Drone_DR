using UnrealBuildTool;
using System.Collections.Generic;

public class DroneWorldEditorTarget : TargetRules
{
    public DroneWorldEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        ExtraModuleNames.Add("DroneWorld");
    }
}
