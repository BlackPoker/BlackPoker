#!/bin/bash
sphinx-build -b html ./source ./docs
sphinx-build -M latexpdf ./source ./docs
# cd docs/latex
# make latexpdf
