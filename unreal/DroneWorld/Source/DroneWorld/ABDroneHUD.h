#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "ABDroneHUD.generated.h"

UCLASS()
class DRONEWORLD_API AABDroneHUD : public AHUD
{
    GENERATED_BODY()
public:
    virtual void DrawHUD() override;
};
