# MediGuard ATmega328P Firmware Build
# ====================================
# Requires avr-gcc and avr-objcopy (avr-gcc toolchain).
# On macOS: brew tap osx-cross/avr && brew install avr-gcc avr-binutils
#
# Output: build/main.hex  (load into Proteus ATmega328P properties)

MCU    = atmega328p
F_CPU  = 16000000UL
CC     = avr-gcc
CFLAGS = -mmcu=$(MCU) -DF_CPU=$(F_CPU) -O2 -Wall -std=c11
LDFLAGS = -mmcu=$(MCU)

TARGET = build/main

all: $(TARGET).hex

$(TARGET).elf: main.c
	mkdir -p build
	$(CC) $(CFLAGS) $(LDFLAGS) main.c -o $@

$(TARGET).hex: $(TARGET).elf
	avr-objcopy -O ihex -R .eeprom $< $@
	@echo "Built $(TARGET).hex — load into Proteus ATmega328P"

clean:
	rm -rf build

.PHONY: all clean
