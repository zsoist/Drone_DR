#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "ABDronePawn.generated.h"

class UCameraComponent;
class UFloatingPawnMovement;
class USphereComponent;
class USpringArmComponent;
class UStaticMeshComponent;

UCLASS()
class DRONEWORLD_API AABDronePawn : public APawn
{
    GENERATED_BODY()

public:
    AABDronePawn();
    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Drone")
    float AGLMeters = 0.0f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category="Drone")
    bool bFPVActive = true;

protected:
    virtual void BeginPlay() override;

private:
    UPROPERTY(VisibleAnywhere)
    USphereComponent* Collision;
    UPROPERTY(VisibleAnywhere)
    UStaticMeshComponent* Body;
    UPROPERTY(VisibleAnywhere)
    UCameraComponent* FPVCamera;
    UPROPERTY(VisibleAnywhere)
    USpringArmComponent* CameraBoom;
    UPROPERTY(VisibleAnywhere)
    UCameraComponent* ThirdPersonCamera;
    UPROPERTY(VisibleAnywhere)
    UFloatingPawnMovement* Movement;

    FTransform ResetTransform;
    void MoveForward(float Value);
    void MoveRight(float Value);
    void MoveUp(float Value);
    void Yaw(float Value);
    void ToggleCamera();
    void ResetDrone();

    UFUNCTION()
    void OnComponentHit(UPrimitiveComponent* HitComponent, AActor* OtherActor,
        UPrimitiveComponent* OtherComponent, FVector NormalImpulse, const FHitResult& Hit);
};
