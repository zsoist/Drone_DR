#include "ABDroneHUD.h"

#include "ABDronePawn.h"
#include "Engine/Canvas.h"
#include "GameFramework/PlayerController.h"

void AABDroneHUD::DrawHUD()
{
    Super::DrawHUD();
    const AABDronePawn* Drone = Cast<AABDronePawn>(GetOwningPawn());
    if (!Drone || !Canvas) return;
    const FString AGL = FString::Printf(TEXT("AGL: %.1f m"), Drone->AGLMeters);
    const FString Camera = FString::Printf(TEXT("Camera: %s"), Drone->bFPVActive ? TEXT("FPV") : TEXT("Third Person"));
    DrawText(AGL, FLinearColor::White, 30.0f, 30.0f, nullptr, 1.2f);
    DrawText(Camera, FLinearColor::White, 30.0f, 55.0f, nullptr, 1.2f);
}
