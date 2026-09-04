#include "ABDronePawn.h"

#include "Camera/CameraComponent.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/World.h"
#include "GameFramework/FloatingPawnMovement.h"
#include "GameFramework/SpringArmComponent.h"

AABDronePawn::AABDronePawn()
{
    PrimaryActorTick.bCanEverTick = true;
    AutoPossessPlayer = EAutoReceiveInput::Player0;

    Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
    Collision->InitSphereRadius(28.0f);
    Collision->SetCollisionProfileName(TEXT("Pawn"));
    Collision->SetNotifyRigidBodyCollision(true);
    Collision->OnComponentHit.AddDynamic(this, &AABDronePawn::OnComponentHit);
    RootComponent = Collision;

    Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
    Body->SetupAttachment(Collision);
    Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

    FPVCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FPVCamera"));
    FPVCamera->SetupAttachment(Collision);
    FPVCamera->SetRelativeLocation(FVector(30.0f, 0.0f, 5.0f));

    CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
    CameraBoom->SetupAttachment(Collision);
    CameraBoom->TargetArmLength = 350.0f;
    CameraBoom->bEnableCameraLag = true;
    CameraBoom->CameraLagSpeed = 8.0f;

    ThirdPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ThirdPersonCamera"));
    ThirdPersonCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
    ThirdPersonCamera->SetActive(false);

    Movement = CreateDefaultSubobject<UFloatingPawnMovement>(TEXT("Movement"));
    Movement->MaxSpeed = 1200.0f;
    Movement->Acceleration = 2400.0f;
    Movement->Deceleration = 3200.0f;
}

void AABDronePawn::BeginPlay()
{
    Super::BeginPlay();
    ResetTransform = GetActorTransform();
}

void AABDronePawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    FHitResult GroundHit;
    const FVector Start = GetActorLocation();
    const FVector End = Start - FVector(0.0f, 0.0f, 100000.0f);
    FCollisionQueryParams Params(SCENE_QUERY_STAT(DroneAGL), false, this);
    if (GetWorld()->LineTraceSingleByChannel(GroundHit, Start, End, ECC_Visibility, Params))
    {
        AGLMeters = FVector::Distance(Start, GroundHit.ImpactPoint) / 100.0f;
    }
    else
    {
        AGLMeters = -1.0f;
    }
}

void AABDronePawn::SetupPlayerInputComponent(UInputComponent* Input)
{
    Super::SetupPlayerInputComponent(Input);
    Input->BindAxis("MoveForward", this, &AABDronePawn::MoveForward);
    Input->BindAxis("MoveRight", this, &AABDronePawn::MoveRight);
    Input->BindAxis("MoveUp", this, &AABDronePawn::MoveUp);
    Input->BindAxis("Yaw", this, &AABDronePawn::Yaw);
    Input->BindAction("ToggleCamera", IE_Pressed, this, &AABDronePawn::ToggleCamera);
    Input->BindAction("ResetDrone", IE_Pressed, this, &AABDronePawn::ResetDrone);
}

void AABDronePawn::MoveForward(float Value) { AddMovementInput(GetActorForwardVector(), Value); }
void AABDronePawn::MoveRight(float Value) { AddMovementInput(GetActorRightVector(), Value); }
void AABDronePawn::MoveUp(float Value) { AddMovementInput(FVector::UpVector, Value); }
void AABDronePawn::Yaw(float Value) { AddControllerYawInput(Value); }

void AABDronePawn::ToggleCamera()
{
    bFPVActive = !bFPVActive;
    FPVCamera->SetActive(bFPVActive);
    ThirdPersonCamera->SetActive(!bFPVActive);
}

void AABDronePawn::ResetDrone()
{
    SetActorTransform(ResetTransform, false, nullptr, ETeleportType::TeleportPhysics);
    Movement->StopMovementImmediately();
}

void AABDronePawn::OnComponentHit(UPrimitiveComponent*, AActor*, UPrimitiveComponent*, FVector, const FHitResult& Hit)
{
    if (Hit.ImpactNormal.Z < -0.5f)
    {
        Movement->StopMovementImmediately();
    }
}
