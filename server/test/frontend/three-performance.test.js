/**
 * three-performance.test.js — Test Suite for TKS 3D Performance Optimization
 *
 * Tests for Task 12: Performance Optimization and Testing
 * Run in browser console or with a test runner
 */

(function() {
  'use strict';

  // This file is a browser-only in-page harness loaded via <script> from
  // performance-test.html (window.TKSPerformanceTests.run()). It is NOT a
  // node:test module, but its *.test.js suffix means `node --test` picks it
  // up automatically — guard against that environment so the Node test run
  // doesn't crash on the missing `document`/`window` globals.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // Simple test framework
  const TestRunner = {
    tests: [],
    passed: 0,
    failed: 0,
    
    describe(suiteName, fn) {
      console.group(`${suiteName}`);
      fn();
      console.groupEnd();
    },
    
    it(testName, fn) {
      try {
        fn();
        this.passed++;
        console.log(`  [PASS] ${testName}`);
      } catch (err) {
        this.failed++;
        console.error(`  [FAIL] ${testName}`);
        console.error(`     ${err.message}`);
      }
    },
    
    assert(condition, message) {
      if (!condition) {
        throw new Error(message || 'Assertion failed');
      }
    },
    
    assertEqual(actual, expected, message) {
      if (actual !== expected) {
        throw new Error(message || `Expected ${expected}, got ${actual}`);
      }
    },
    
    assertExists(value, message) {
      if (value === undefined || value === null) {
        throw new Error(message || 'Value should exist');
      }
    },
    
    assertType(value, type, message) {
      if (typeof value !== type) {
        throw new Error(message || `Expected type ${type}, got ${typeof value}`);
      }
    },
    
    summary() {
      console.log('\n' + '='.repeat(60));
      console.log(`Test Summary: ${this.passed} passed, ${this.failed} failed`);
      console.log('='.repeat(60));
      return this.failed === 0;
    }
  };

  // Wait for all modules to load
  function waitForModules(callback) {
    const checkInterval = setInterval(() => {
      if (window.TKSPerformance && window.TKSMemory && window.TKSVisibility) {
        clearInterval(checkInterval);
        callback();
      }
    }, 100);
    
    // Timeout after 5 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      console.error('Modules failed to load within timeout');
    }, 5000);
  }

  // Run all tests
  function runTests() {
    console.clear();
    console.log('TKS 3D Performance Test Suite');
    console.log('='.repeat(60) + '\n');

    // Test 1: Performance Monitor Initialization
    TestRunner.describe('TKSPerformance - Initialization', () => {
      TestRunner.it('should be globally available', () => {
        TestRunner.assertExists(window.TKSPerformance, 'TKSPerformance not found');
      });

      TestRunner.it('should have FPS tracking properties', () => {
        TestRunner.assertExists(window.TKSPerformance.fps);
        TestRunner.assertType(window.TKSPerformance.fps, 'number');
      });

      TestRunner.it('should have quality settings', () => {
        TestRunner.assertExists(window.TKSPerformance.quality);
        const validQualities = ['high', 'medium', 'low', 'minimal'];
        TestRunner.assert(
          validQualities.includes(window.TKSPerformance.quality),
          `Invalid quality: ${window.TKSPerformance.quality}`
        );
      });

      TestRunner.it('should detect device capabilities', () => {
        TestRunner.assertExists(window.TKSPerformance.capabilities);
        TestRunner.assertType(window.TKSPerformance.capabilities.isMobile, 'boolean');
        TestRunner.assertType(window.TKSPerformance.capabilities.isLowEnd, 'boolean');
        TestRunner.assertType(window.TKSPerformance.capabilities.maxParticles, 'number');
      });

      TestRunner.it('should have performance thresholds', () => {
        const thresholds = window.TKSPerformance.thresholds;
        TestRunner.assertExists(thresholds);
        TestRunner.assert(thresholds.fpsGood > thresholds.fpsMedium);
        TestRunner.assert(thresholds.fpsMedium > thresholds.fpsLow);
      });
    });

    // Test 2: Quality Management
    TestRunner.describe('TKSPerformance - Quality Management', () => {
      TestRunner.it('should return quality settings', () => {
        const settings = window.TKSPerformance.getQualitySettings();
        TestRunner.assertExists(settings);
        TestRunner.assertExists(settings.particleCount);
        TestRunner.assertExists(settings.pixelRatio);
        TestRunner.assertType(settings.particleCount, 'number');
      });

      TestRunner.it('should adjust quality settings based on level', () => {
        const originalQuality = window.TKSPerformance.quality;
        
        window.TKSPerformance.setQuality('high');
        const highSettings = window.TKSPerformance.getQualitySettings();
        
        window.TKSPerformance.setQuality('low');
        const lowSettings = window.TKSPerformance.getQualitySettings();
        
        TestRunner.assert(
          highSettings.particleCount > lowSettings.particleCount,
          'High quality should have more particles'
        );
        
        // Restore original
        window.TKSPerformance.setQuality(originalQuality);
      });

      TestRunner.it('should disable auto-adjust when quality is manually set', () => {
        window.TKSPerformance.setQuality('medium');
        TestRunner.assertEqual(window.TKSPerformance.autoAdjust, false);
        
        // Re-enable for other tests
        window.TKSPerformance.enableAutoAdjust();
      });

      TestRunner.it('should provide quality change events', (done) => {
        let eventFired = false;
        
        const handler = (e) => {
          eventFired = true;
          TestRunner.assertExists(e.detail);
          TestRunner.assertExists(e.detail.quality);
          window.removeEventListener('tks-quality-change', handler);
        };
        
        window.addEventListener('tks-quality-change', handler);
        window.TKSPerformance.setQuality('low');
        
        // Event should fire synchronously
        TestRunner.assert(eventFired, 'Quality change event should fire');
      });
    });

    // Test 3: FPS Monitoring
    TestRunner.describe('TKSPerformance - FPS Monitoring', () => {
      TestRunner.it('should track FPS updates', () => {
        const initialFrames = window.TKSPerformance.frames;
        window.TKSPerformance.update();
        window.TKSPerformance.update();
        TestRunner.assert(
          window.TKSPerformance.frames >= initialFrames,
          'Frame count should increase'
        );
      });

      TestRunner.it('should calculate average FPS', () => {
        window.TKSPerformance.fpsHistory = [60, 58, 59, 60, 57];
        const avg = window.TKSPerformance.getAverageFPS();
        TestRunner.assertType(avg, 'number');
        TestRunner.assert(avg >= 57 && avg <= 60, 'Average should be in range');
      });

      TestRunner.it('should track min and max FPS', () => {
        window.TKSPerformance.fpsHistory = [45, 60, 55, 50, 58];
        const min = window.TKSPerformance.getMinFPS();
        const max = window.TKSPerformance.getMaxFPS();
        TestRunner.assertEqual(min, 45);
        TestRunner.assertEqual(max, 60);
      });

      TestRunner.it('should generate performance report', () => {
        const report = window.TKSPerformance.getReport();
        TestRunner.assertExists(report);
        TestRunner.assertExists(report.fps);
        TestRunner.assertExists(report.quality);
        TestRunner.assertExists(report.capabilities);
      });
    });

    // Test 4: Memory Management
    TestRunner.describe('TKSMemory - Initialization', () => {
      TestRunner.it('should be globally available', () => {
        TestRunner.assertExists(window.TKSMemory);
      });

      TestRunner.it('should track WebGL contexts', () => {
        TestRunner.assertExists(window.TKSMemory.webglContexts);
        TestRunner.assert(Array.isArray(window.TKSMemory.webglContexts));
      });

      TestRunner.it('should have resource tracking sets', () => {
        TestRunner.assertExists(window.TKSMemory.geometries);
        TestRunner.assertExists(window.TKSMemory.materials);
        TestRunner.assertExists(window.TKSMemory.textures);
      });

      TestRunner.it('should have context limits', () => {
        TestRunner.assertType(window.TKSMemory.maxContexts, 'number');
        TestRunner.assert(window.TKSMemory.maxContexts > 0);
      });
    });

    // Test 5: Memory Tracking
    TestRunner.describe('TKSMemory - Resource Tracking', () => {
      TestRunner.it('should track geometries', () => {
        const mockGeometry = { dispose: () => {} };
        const tracked = window.TKSMemory.trackGeometry(mockGeometry);
        TestRunner.assertEqual(tracked, mockGeometry);
        TestRunner.assert(window.TKSMemory.geometries.has(mockGeometry));
        
        // Cleanup
        window.TKSMemory.geometries.delete(mockGeometry);
      });

      TestRunner.it('should track materials', () => {
        const mockMaterial = { dispose: () => {} };
        const tracked = window.TKSMemory.trackMaterial(mockMaterial);
        TestRunner.assertEqual(tracked, mockMaterial);
        TestRunner.assert(window.TKSMemory.materials.has(mockMaterial));
        
        // Cleanup
        window.TKSMemory.materials.delete(mockMaterial);
      });

      TestRunner.it('should track textures', () => {
        const mockTexture = { dispose: () => {} };
        const tracked = window.TKSMemory.trackTexture(mockTexture);
        TestRunner.assertEqual(tracked, mockTexture);
        TestRunner.assert(window.TKSMemory.textures.has(mockTexture));
        
        // Cleanup
        window.TKSMemory.textures.delete(mockTexture);
      });

      TestRunner.it('should generate memory report', () => {
        const report = window.TKSMemory.getReport();
        TestRunner.assertExists(report);
        TestRunner.assertType(report.contexts, 'number');
        TestRunner.assertType(report.geometries, 'number');
        TestRunner.assertType(report.materials, 'number');
        TestRunner.assertType(report.textures, 'number');
      });
    });

    // Test 6: Memory Leak Detection
    TestRunner.describe('TKSMemory - Leak Detection', () => {
      TestRunner.it('should detect excessive resources', () => {
        // Add many mock geometries
        const originalSize = window.TKSMemory.geometries.size;
        const mocks = [];
        for (let i = 0; i < 110; i++) {
          const mock = { dispose: () => {} };
          window.TKSMemory.trackGeometry(mock);
          mocks.push(mock);
        }
        
        const issues = window.TKSMemory.checkLeaks();
        const hasGeometryIssue = issues.some(i => i.type === 'excessive_geometries');
        TestRunner.assert(hasGeometryIssue, 'Should detect excessive geometries');
        
        // Cleanup
        mocks.forEach(m => window.TKSMemory.geometries.delete(m));
      });

      TestRunner.it('should check memory usage if available', () => {
        if (performance.memory) {
          const memory = window.TKSMemory.checkMemory();
          TestRunner.assertExists(memory);
          TestRunner.assertExists(memory.usedMB);
          TestRunner.assertExists(memory.percentage);
        } else {
          console.log('     [INFO] performance.memory not available');
        }
      });
    });

    // Test 7: Visibility Management
    TestRunner.describe('TKSVisibility - Initialization', () => {
      TestRunner.it('should be globally available', () => {
        TestRunner.assertExists(window.TKSVisibility);
      });

      TestRunner.it('should track visibility state', () => {
        TestRunner.assertType(window.TKSVisibility.isVisible, 'boolean');
      });

      TestRunner.it('should have component registry', () => {
        TestRunner.assertExists(window.TKSVisibility.components);
      });
    });

    // Test 8: Component Registration
    TestRunner.describe('TKSVisibility - Component Management', () => {
      TestRunner.it('should register components', () => {
        let pauseCalled = false;
        let resumeCalled = false;
        
        window.TKSVisibility.register(
          'TestComponent',
          () => { pauseCalled = true; },
          () => { resumeCalled = true; }
        );
        
        TestRunner.assert(window.TKSVisibility.components.has('TestComponent'));
        
        // Cleanup
        window.TKSVisibility.unregister('TestComponent');
      });

      TestRunner.it('should unregister components', () => {
        window.TKSVisibility.register('TestComponent2', () => {}, () => {});
        window.TKSVisibility.unregister('TestComponent2');
        TestRunner.assert(!window.TKSVisibility.components.has('TestComponent2'));
      });

      TestRunner.it('should pause and resume specific components', () => {
        let pauseCount = 0;
        let resumeCount = 0;
        
        window.TKSVisibility.register(
          'TestComponent3',
          () => { pauseCount++; },
          () => { resumeCount++; }
        );
        
        window.TKSVisibility.pause('TestComponent3');
        TestRunner.assertEqual(pauseCount, 1);
        
        window.TKSVisibility.resume('TestComponent3');
        TestRunner.assertEqual(resumeCount, 1);
        
        // Cleanup
        window.TKSVisibility.unregister('TestComponent3');
      });

      TestRunner.it('should generate visibility statistics', () => {
        const stats = window.TKSVisibility.getStats();
        TestRunner.assertExists(stats);
        TestRunner.assertExists(stats.isVisible);
        TestRunner.assertExists(stats.currentState);
        TestRunner.assertType(stats.componentCount, 'number');
      });
    });

    // Test 9: Integration Tests
    TestRunner.describe('Integration - Cross-Component Communication', () => {
      TestRunner.it('should coordinate quality changes across components', (done) => {
        let eventReceived = false;
        
        const handler = (e) => {
          eventReceived = true;
          TestRunner.assertExists(e.detail);
          window.removeEventListener('tks-quality-change', handler);
        };
        
        window.addEventListener('tks-quality-change', handler);
        window.TKSPerformance.setQuality('high');
        
        TestRunner.assert(eventReceived, 'Quality change event should propagate');
      });

      TestRunner.it('should coordinate visibility changes', () => {
        let pausedComponents = 0;
        let resumedComponents = 0;
        
        // Register test components
        for (let i = 0; i < 3; i++) {
          window.TKSVisibility.register(
            `IntegrationTest${i}`,
            () => { pausedComponents++; },
            () => { resumedComponents++; }
          );
        }
        
        window.TKSVisibility.pauseAll();
        TestRunner.assertEqual(pausedComponents, 3, 'All components should be paused');
        
        window.TKSVisibility.resumeAll();
        TestRunner.assertEqual(resumedComponents, 3, 'All components should be resumed');
        
        // Cleanup
        for (let i = 0; i < 3; i++) {
          window.TKSVisibility.unregister(`IntegrationTest${i}`);
        }
      });

      TestRunner.it('should track performance metrics correctly', () => {
        window.TKSPerformance.startMonitoring();
        
        // Simulate some frames
        for (let i = 0; i < 10; i++) {
          window.TKSPerformance.update();
        }
        
        TestRunner.assert(window.TKSPerformance.monitoring, 'Monitoring should be active');
        TestRunner.assert(window.TKSPerformance.frames >= 10, 'Frames should be tracked');
      });
    });

    // Test 10: Performance Regression Tests
    TestRunner.describe('Performance - Regression Tests', () => {
      TestRunner.it('should not leak memory on repeated quality changes', () => {
        const initialGeometries = window.TKSMemory.geometries.size;
        const initialMaterials = window.TKSMemory.materials.size;
        
        // Change quality multiple times
        for (let i = 0; i < 5; i++) {
          window.TKSPerformance.setQuality('high');
          window.TKSPerformance.setQuality('low');
        }
        
        // Should not have accumulated resources (assuming proper cleanup)
        const finalGeometries = window.TKSMemory.geometries.size;
        const finalMaterials = window.TKSMemory.materials.size;
        
        TestRunner.assert(
          finalGeometries === initialGeometries,
          'Geometry count should remain stable'
        );
      });

      TestRunner.it('should handle rapid visibility changes', () => {
        let pauseCount = 0;
        let resumeCount = 0;
        
        window.TKSVisibility.register(
          'RapidTest',
          () => { pauseCount++; },
          () => { resumeCount++; }
        );
        
        // Rapid pause/resume
        for (let i = 0; i < 10; i++) {
          window.TKSVisibility.pause('RapidTest');
          window.TKSVisibility.resume('RapidTest');
        }
        
        TestRunner.assertEqual(pauseCount, 10);
        TestRunner.assertEqual(resumeCount, 10);
        
        // Cleanup
        window.TKSVisibility.unregister('RapidTest');
      });
    });

    // Print summary
    const allPassed = TestRunner.summary();
    
    // Return result for programmatic usage
    return {
      passed: TestRunner.passed,
      failed: TestRunner.failed,
      success: allPassed
    };
  }

  // Auto-run tests when modules are ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      waitForModules(runTests);
    });
  } else {
    waitForModules(runTests);
  }

  // Expose test runner globally for manual execution
  window.TKSPerformanceTests = {
    run: runTests,
    runner: TestRunner
  };

})();
