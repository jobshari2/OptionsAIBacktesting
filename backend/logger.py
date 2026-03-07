import logging
import sys

def setup_logger():
    logger = logging.getLogger("options_backtesting")
    
    # Only configure if no handlers are present to avoid duplicate logs
    if getattr(logger, 'is_configured', False):
        return logger

    logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        fmt="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        datefmt="%d/%m/%Y %H:%M:%S"
    )

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    logger.is_configured = True
    return logger

logger = setup_logger()
