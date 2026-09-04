#include "DroneWorldGameMode.h"

#include "ABDroneHUD.h"
#include "ABDronePawn.h"

ADroneWorldGameMode::ADroneWorldGameMode()
{
    DefaultPawnClass = AABDronePawn::StaticClass();
    HUDClass = AABDroneHUD::StaticClass();
}
